// background.js: Service Worker 后台服务 (Manifest V3 - v1.0.1)
// 职责：精准 frameId 绑定、分批推理 (Batch Chunking)、60s超时与AbortController、session持久化、安全 API 规范化
(function () {
  'use strict';

  let currentAbortController = null;

  // 全局持久化状态
  let taskState = {
    isRunning: false,
    statusText: '就绪',
    progress: 0,
    current: 0,
    total: 0,
    logs: [],
    activeTabId: null,
    activeFrameId: null
  };

  // 恢复会话状态
  const storageArea = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session)
    ? chrome.storage.session
    : chrome.storage.local;

  storageArea.get(['taskState'], (res) => {
    if (res && res.taskState) {
      taskState = { ...taskState, ...res.taskState, isRunning: false };
    }
  });

  function saveTaskState() {
    try {
      storageArea.set({ taskState }).catch(() => {});
    } catch (e) {}
  }

  function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logItem = `[${timestamp}] ${message}`;
    taskState.logs.push(logItem);
    if (taskState.logs.length > 200) {
      taskState.logs.shift();
    }
    saveTaskState();
    chrome.runtime.sendMessage({ action: 'LOG_BROADCAST', log: logItem }).catch(() => {});
  }

  function updateState(partial) {
    taskState = { ...taskState, ...partial };
    saveTaskState();
    chrome.runtime.sendMessage({ action: 'STATE_BROADCAST', state: taskState }).catch(() => {});
  }

  // 智能规范化 API 地址
  function normalizeApiUrl(baseUrl) {
    let urlStr = (baseUrl || '').trim();
    if (!urlStr) {
      urlStr = 'https://api.openai.com/v1';
    }
    urlStr = urlStr.replace(/\/+$/, '');
    if (urlStr.endsWith('/chat/completions')) {
      return urlStr;
    }
    try {
      const parsed = new URL(urlStr);
      if (!parsed.pathname || parsed.pathname === '/') {
        return `${urlStr}/v1/chat/completions`;
      }
    } catch (_) {}
    return `${urlStr}/chat/completions`;
  }

  // 精准定位持有题目 DOM 的 frameId
  async function findQuizFrameId(tabId) {
    try {
      if (typeof chrome.scripting !== 'undefined' && chrome.scripting.executeScript) {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => Boolean(document.querySelector('div.questionLi[id^="question"], [id^="question"][data], h3.mark_name'))
        });
        if (Array.isArray(results)) {
          const match = results.find((r) => r.result === true);
          if (match && typeof match.frameId === 'number') {
            return match.frameId;
          }
        }
      }
    } catch (e) {
      console.warn('[Background] findQuizFrameId error:', e);
    }
    return null;
  }

  // 测试 API 连通性
  async function testApiConnection(config) {
    const { baseUrl, apiKey, model } = config;
    const endpoint = normalizeApiUrl(baseUrl);
    const modelName = (model || 'Agnes-3.0-flash').trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空，请先填写并保存');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), 15000);

    try {
      const payload = {
        model: modelName,
        messages: [
          { role: 'system', content: 'You are a test assistant. Answer with only "OK".' },
          { role: 'user', content: 'Ping' }
        ],
        max_tokens: 10,
        temperature: 0.1
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        let errText = '';
        try {
          const errJson = await response.json();
          errText = errJson.error ? (errJson.error.message || JSON.stringify(errJson.error)) : JSON.stringify(errJson);
        } catch (e) {
          errText = await response.text();
        }
        throw new Error(`API 请求失败 (HTTP ${response.status}): ${errText}`);
      }

      const data = await response.json();
      const replyText = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content.trim()
        : '';

      return {
        success: true,
        model: modelName,
        endpoint,
        reply: replyText
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('测试连接超时 (15s)，请检查 API 地址或网络代理');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 单批题目推理
  async function requestAiInferenceBatch(questionsBatch, config, batchIdx, totalBatches) {
    const { baseUrl, apiKey, model, temperature } = config;
    const endpoint = normalizeApiUrl(baseUrl);
    const modelName = (model || 'Agnes-3.0-flash').trim();

    appendLog(`[AI推理] 批次 [${batchIdx}/${totalBatches}] 正在向模型 [${modelName}] 发送 ${questionsBatch.length} 题...`);

    const systemPrompt = `你是一个大学在线教育与超星学习通平台的答题专家。你将收到一组题目列表。
请根据题干及给出的选项（若有），推导出绝对准确的答案。

严格遵守以下输出格式与规则：
1. 单选题：返回字母，如 "A"、"B"、"C"、"D"。
2. 多选题：返回所有正确选项字母的连续大写字符串，按字母顺序排列，如 "ABD"、"AC"。
3. 判断题：如果是正确/对，返回 "true"；如果是错误/错，返回 "false"。严禁返回中文"对"或"错"。
4. 填空题：返回字符串数组，数组项按空位顺序对应，如 ["第一空答案", "第二空答案"]。若题干有多个空，请务必返回对应数量的独立元素。
5. 简答题/主观题：返回切中要点、简明扼要的答案文本数组，如 ["答：核心原因在于..."]。
6. 必须输出合法的 JSON 对象，每题必须保留唯一的 "qid" 字段和 "num" 字段，不要输出任何额外的打招呼或解释性文字。

输出 JSON Schema 必须为：
{
  "answers": [
    {
      "qid": "215293304",
      "num": 1,
      "type": "0",
      "choice": "A",
      "fill": []
    },
    {
      "qid": "215293305",
      "num": 2,
      "type": "2",
      "choice": "",
      "fill": ["词语1", "词语2"]
    }
  ]
}`;

    const userContent = JSON.stringify(questionsBatch, null, 2);
    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请回答以下题目，严格输出 JSON：\n${userContent}` }
      ],
      temperature: typeof temperature === 'number' ? temperature : 0.2
    };

    const controller = new AbortController();
    currentAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), 60000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        let errText = '';
        try {
          const errJson = await response.json();
          errText = errJson.error ? (errJson.error.message || JSON.stringify(errJson.error)) : JSON.stringify(errJson);
        } catch (e) {
          errText = await response.text();
        }
        throw new Error(`AI 推理接口异常 (HTTP ${response.status}): ${errText}`);
      }

      const resJson = await response.json();
      const rawContent = resJson.choices && resJson.choices[0] && resJson.choices[0].message
        ? resJson.choices[0].message.content
        : '';

      if (!rawContent) {
        throw new Error('大模型未返回有效文本内容');
      }

      let cleaned = rawContent.trim();
      if (cleaned.includes('```json')) {
        const match = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
        if (match) cleaned = match[1].trim();
      } else if (cleaned.includes('```')) {
        const match = cleaned.match(/```\s*([\s\S]*?)\s*```/);
        if (match) cleaned = match[1].trim();
      }

      let parsedResult;
      try {
        parsedResult = JSON.parse(cleaned);
      } catch (parseErr) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          parsedResult = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } else {
          throw new Error(`无法解析模型返回的 JSON：${cleaned.slice(0, 150)}...`);
        }
      }

      if (!parsedResult || !Array.isArray(parsedResult.answers)) {
        throw new Error('模型输出缺少 answers 数组格式');
      }

      appendLog(`[AI推理] 批次 [${batchIdx}/${totalBatches}] 推理成功，获得 ${parsedResult.answers.length} 题答案。`);
      return parsedResult.answers;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('大模型响应超时 (60s) 或已被用户手动取消');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (currentAbortController === controller) {
        currentAbortController = null;
      }
    }
  }

  // 监听通信
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'GET_TASK_STATE': {
        sendResponse({ success: true, state: taskState });
        break;
      }

      case 'CLEAR_LOGS': {
        taskState.logs = [];
        saveTaskState();
        sendResponse({ success: true });
        break;
      }

      case 'STOP_TASK': {
        if (currentAbortController) {
          try {
            currentAbortController.abort('USER_CANCELLED');
          } catch (e) {}
          currentAbortController = null;
        }
        appendLog('🛑 用户已手动停止任务');
        updateState({ isRunning: false, statusText: '已手动停止' });

        if (taskState.activeTabId != null) {
          const sendOpts = taskState.activeFrameId != null ? { frameId: taskState.activeFrameId } : {};
          chrome.tabs.sendMessage(taskState.activeTabId, { action: 'STOP_TASK' }, sendOpts).catch(() => {});
        }
        sendResponse({ success: true });
        return false;
      }

      case 'TEST_CONNECTION': {
        testApiConnection(request.config)
          .then((res) => sendResponse({ success: true, data: res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      case 'START_TASK_FLOW': {
        const { tabId, config, frameId: passedFrameId } = request;

        (async () => {
          try {
            updateState({ isRunning: true, progress: 5, statusText: '正在绑定测验 Frame...', activeTabId: tabId });
            appendLog('[启动] 正在探测测验 Frame 并提取题目...');

            // 定位 targetFrameId
            let targetFrameId = typeof passedFrameId === 'number' ? passedFrameId : (await findQuizFrameId(tabId));
            updateState({ activeFrameId: targetFrameId });

            const sendOpts = typeof targetFrameId === 'number' ? { frameId: targetFrameId } : {};
            const extractRes = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_QUESTIONS' }, sendOpts);

            if (!extractRes || !extractRes.success || !extractRes.questions || extractRes.questions.length === 0) {
              throw new Error('未能从页面提取到有效题目，请确认是否处于作业作答区');
            }

            const questions = extractRes.questions;
            const totalQuestions = questions.length;
            updateState({ progress: 15, total: totalQuestions, statusText: `已抽取 ${totalQuestions} 题，开始分批推理...` });
            appendLog(`[提取] 成功抽取 ${totalQuestions} 题 (Frame: ${targetFrameId ?? '默认'})，启动分批推理...`);

            // 按每 10 题分片
            const BATCH_SIZE = 10;
            const chunks = [];
            for (let i = 0; i < questions.length; i += BATCH_SIZE) {
              chunks.push(questions.slice(i, i + BATCH_SIZE));
            }

            const allAnswers = [];
            for (let b = 0; b < chunks.length; b++) {
              if (!taskState.isRunning) {
                appendLog('[中断] 任务已停止，中止后续推理。');
                return;
              }

              const batchAnswers = await requestAiInferenceBatch(chunks[b], config, b + 1, chunks.length);
              allAnswers.push(...batchAnswers);

              const inferProgress = 15 + Math.round(((b + 1) / chunks.length) * 35);
              updateState({ progress: inferProgress, statusText: `推理进度: ${allAnswers.length}/${totalQuestions}` });
            }

            if (!taskState.isRunning) return;

            updateState({ progress: 50, statusText: '推理完毕，开始拟真作答...' });
            appendLog('[作答] 向测验 Frame 发送全量答案并启动拟真键鼠作答...');

            await chrome.tabs.sendMessage(tabId, {
              action: 'START_EXECUTION',
              answersData: { answers: allAnswers },
              autoSubmit: config.autoSubmit !== false
            }, sendOpts);

          } catch (err) {
            appendLog(`[错误] ${err.message}`);
            updateState({ isRunning: false, statusText: '执行失败: ' + err.message });
          }
        })();

        sendResponse({ success: true });
        return true;
      }

      case 'LOG_UPDATE': {
        appendLog(request.log);
        sendResponse({ success: true });
        break;
      }

      case 'PROGRESS_UPDATE': {
        const mappedProgress = 50 + Math.round((request.progress / 100) * 50);
        updateState({
          progress: Math.min(100, mappedProgress),
          current: request.current,
          total: request.total,
          statusText: request.statusText
        });
        sendResponse({ success: true });
        break;
      }

      case 'TASK_COMPLETED': {
        appendLog(`[完成] ${request.message}`);
        updateState({ isRunning: false, progress: 100, statusText: '已提交完成' });
        sendResponse({ success: true });
        break;
      }

      case 'TASK_ERROR': {
        appendLog(`[异常] ${request.error}`);
        updateState({ isRunning: false, statusText: '异常终止: ' + request.error });
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });
})();
