// background.js: Service Worker 后台服务 (Manifest V3)
// 职责：大模型 API 统一接入（规避网页 CSP/跨域限制）、任务生命周期与日志状态中继、连接测试
(function () {
  'use strict';

  // 全局持久状态
  let taskState = {
    isRunning: false,
    statusText: '就绪',
    progress: 0,
    current: 0,
    total: 0,
    logs: []
  };

  function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logItem = `[${timestamp}] ${message}`;
    taskState.logs.push(logItem);
    if (taskState.logs.length > 200) {
      taskState.logs.shift();
    }
    // 通知打开的 popup
    chrome.runtime.sendMessage({ action: 'LOG_BROADCAST', log: logItem }).catch(() => {});
  }

  function updateState(partial) {
    taskState = { ...taskState, ...partial };
    chrome.runtime.sendMessage({ action: 'STATE_BROADCAST', state: taskState }).catch(() => {});
  }

  // 格式化 API Endpoint
  function normalizeApiUrl(baseUrl) {
    let url = (baseUrl || '').trim();
    if (!url) {
      url = 'https://api.openai.com/v1';
    }
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/chat/completions')) {
      url = `${url}/chat/completions`;
    }
    return url;
  }

  // 测试 API 连通性
  async function testApiConnection(config) {
    const { baseUrl, apiKey, model } = config;
    const endpoint = normalizeApiUrl(baseUrl);
    const modelName = (model || 'Agnes-3.0-flash').trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空，请先填写并保存');
    }

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
      body: JSON.stringify(payload)
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
  }

  // 调用大模型进行题目推理
  async function requestAiInference(questions, config) {
    const { baseUrl, apiKey, model, temperature } = config;
    const endpoint = normalizeApiUrl(baseUrl);
    const modelName = (model || 'Agnes-3.0-flash').trim();

    appendLog(`[AI推理] 正在向模型 [${modelName}] 发送 ${questions.length} 道题目进行推理...`);

    const systemPrompt = `你是一个大学课程作业答题专家。你将收到一组从超星学习通平台抽取的题目列表。
请根据题目题型、题干及给出的选项（若有），推导出绝对准确的答案。

严格遵守以下输出格式与规则：
1. 单选题：返回字母，如 "A"、"B"、"C"、"D"。
2. 多选题：返回所有正确选项字母的连续大写字符串，按字母顺序排列，如 "ABD"、"AC"。
3. 判断题：如果是正确/对，返回 "true"；如果是错误/错，返回 "false"。严禁返回中文"对"或"错"。
4. 填空题：返回字符串数组，数组项按空位顺序对应，如 ["第一空答案", "第二空答案"]。不要添加多余解释或标点。
5. 简答题/主观题：返回切中要点、简明扼要的答案文本数组，如 ["答：核心原因在于..."]。
6. 严格输出为合法的 JSON 对象，不要输出任何额外的打招呼或解释性文字。

输出 JSON Schema 必须为：
{
  "answers": [
    {
      "num": 1,
      "type": "单选题",
      "choice": "A"
    },
    {
      "num": 2,
      "type": "多选题",
      "choice": "ACD"
    },
    {
      "num": 3,
      "type": "判断题",
      "choice": "true"
    },
    {
      "num": 4,
      "type": "填空题",
      "fill": ["词语1", "词语2"]
    },
    {
      "num": 5,
      "type": "简答题",
      "fill": ["解答内容"]
    }
  ]
}`;

    const userContent = JSON.stringify(questions, null, 2);

    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请回答以下题目，严格输出 JSON：\n${userContent}` }
      ],
      temperature: typeof temperature === 'number' ? temperature : 0.2
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(payload)
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

    // 清洗提取 JSON 内容
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
      // 容错：查找首尾花括号
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

    appendLog(`[AI推理] 答案解析成功，已获取 ${parsedResult.answers.length} 道题目的标准答案。`);
    return parsedResult;
  }

  // 监听来自 popup 与 content_script 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'GET_TASK_STATE': {
        sendResponse({ success: true, state: taskState });
        break;
      }

      case 'CLEAR_LOGS': {
        taskState.logs = [];
        sendResponse({ success: true });
        break;
      }

      case 'TEST_CONNECTION': {
        testApiConnection(request.config)
          .then((res) => sendResponse({ success: true, data: res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      case 'START_TASK_FLOW': {
        const { tabId, config } = request;
        updateState({ isRunning: true, progress: 5, statusText: '正在探测题目 DOM...' });
        appendLog('[启动] 任务开始执行，正在检查标签页与题目...');

        (async () => {
          try {
            // 1. 让 content_script 抽取题目
            appendLog('[提取] 正在从页面 DOM 中读取题目结构...');
            const extractRes = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_QUESTIONS' });
            if (!extractRes || !extractRes.success || !extractRes.questions || extractRes.questions.length === 0) {
              throw new Error('未在当前页面提取到题目，请确认是否处于学习通作业作答页面');
            }

            const questions = extractRes.questions;
            updateState({ progress: 20, total: questions.length, statusText: `已提取 ${questions.length} 题，调用模型推理...` });
            appendLog(`[提取] 成功抽取 ${questions.length} 道题目，开始请求大模型...`);

            // 2. 调用大模型推理答案
            const answersData = await requestAiInference(questions, config);
            updateState({ progress: 45, statusText: '模型推理完毕，开始拟真作答...' });

            // 3. 指示 content_script 开始模拟作答
            appendLog('[作答] 向页面派发拟真键鼠作答指令...');
            await chrome.tabs.sendMessage(tabId, {
              action: 'START_EXECUTION',
              answersData,
              autoSubmit: config.autoSubmit !== false
            });
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
        updateState({
          progress: request.progress,
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
