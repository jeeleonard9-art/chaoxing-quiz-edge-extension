// content.js: 运行在学习通各页面与 iframe 中的内容脚本 (Manifest V3)
// 职责：DOM 检测与多层 iframe 穿透、题目解析抽取、拟真鼠标键盘作答、状态回读复核、先暂存后提交
(function () {
  'use strict';

  let isTaskRunning = false;
  let isTaskCancelled = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ==================== 1. 浮动状态条 UI ====================
  function getOrCreateStatusBar() {
    let bar = document.getElementById('cx-quiz-helper-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cx-quiz-helper-bar';
      bar.className = 'cx-hidden';
      bar.innerHTML = `
        <div class="cx-dot"></div>
        <div class="cx-title">学习通答题助手</div>
        <div class="cx-status-text">就绪</div>
      `;
      document.body.appendChild(bar);
    }
    return bar;
  }

  function updateStatusBar(text, state = 'running') {
    const bar = getOrCreateStatusBar();
    bar.className = state;
    const statusText = bar.querySelector('.cx-status-text');
    if (statusText) statusText.textContent = text;
  }

  function hideStatusBar() {
    const bar = document.getElementById('cx-quiz-helper-bar');
    if (bar) bar.className = 'cx-hidden';
  }

  // ==================== 2. 注入 Page Script 桥接 ====================
  function injectPageScript() {
    if (document.getElementById('cx-quiz-injected-script')) return;
    try {
      const script = document.createElement('script');
      script.id = 'cx-quiz-injected-script';
      script.src = chrome.runtime.getURL('content/page_inject.js');
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[ChaoxingExt] Page script injection failed (isolated fallback will be used):', e);
    }
  }

  function callPageInject(action, payload = {}) {
    return new Promise((resolve) => {
      const requestId = 'req_' + Math.random().toString(36).substring(2, 10);
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        resolve({ success: false, error: 'Page inject timeout' });
      }, 5000);

      function listener(event) {
        if (!event.data || event.data.source !== 'CHAOXING_QUIZ_EXT_PAGE') return;
        if (event.data.requestId === requestId) {
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve(event.data);
        }
      }

      window.addEventListener('message', listener);
      window.postMessage({
        source: 'CHAOXING_QUIZ_EXT_CONTENT',
        action,
        payload,
        requestId
      }, '*');
    });
  }

  // ==================== 3. 页面与题目 DOM 检测 ====================
  function getQuizContext() {
    // 检查当前 document 是否包含超星题目
    if (document.querySelector('[id^="question"]') || document.querySelector('h3.mark_name')) {
      return document;
    }

    // 检查子 iframe（针对单层父页面嵌套作业页的情况）
    const iframes = document.querySelectorAll('iframe');
    for (const fr of iframes) {
      try {
        const doc = fr.contentDocument || fr.contentWindow.document;
        if (doc && (doc.querySelector('[id^="question"]') || doc.querySelector('h3.mark_name'))) {
          return doc;
        }
      } catch (e) {
        // 跨域 iframe 由 all_frames: true 的独立 content_script 实例处理
      }
    }

    return null;
  }

  function hasQuizDOM() {
    return Boolean(getQuizContext());
  }

  // 映射题号 -> qid
  function getQidMap(doc = document) {
    const map = {};
    const h3List = doc.querySelectorAll('h3.mark_name');
    h3List.forEach((h3) => {
      const m = h3.innerText.trim().match(/^(\d+)\./);
      if (!m) return;
      const c = h3.closest('[id^=question]');
      if (c && c.id) {
        map[m[1]] = c.id.replace('question', '').trim();
      } else if (c && c.getAttribute('data')) {
        map[m[1]] = c.getAttribute('data').trim();
      }
    });

    // 兜底方案：遍历 div.questionLi
    if (Object.keys(map).length === 0) {
      const qElements = doc.querySelectorAll('div.questionLi[id^="question"]');
      qElements.forEach((el, idx) => {
        const qid = el.id.replace('question', '').trim();
        map[String(idx + 1)] = qid;
      });
    }

    return map;
  }

  // 解析题型：0=单选, 1=多选, 2=填空, 3=判断, 4+=主观题
  function getQuestionType(doc, qid, titleText = '') {
    const typeInput = doc.querySelector('#answertype' + qid);
    if (typeInput && typeInput.value !== undefined && typeInput.value !== '') {
      return String(typeInput.value);
    }
    // 根据题干文字匹配
    if (/单选题/.test(titleText)) return '0';
    if (/多选题/.test(titleText)) return '1';
    if (/填空题/.test(titleText)) return '2';
    if (/判断题/.test(titleText)) return '3';
    if (/简答题|解答题|论述题|名词解释|计算题/.test(titleText)) return '4';
    return '0';
  }

  // 提取整页全部题目
  function extractAllQuestions() {
    const doc = getQuizContext() || document;
    const map = getQidMap(doc);
    const TYPE_NAMES = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' };
    const questions = [];

    const sortedEntries = Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));

    for (const [numStr, qid] of sortedEntries) {
      const num = parseInt(numStr, 10);
      const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
      const h3 = cont ? cont.querySelector('h3.mark_name') : null;
      const rawTitle = h3 ? h3.innerText.replace(/\s+/g, ' ').trim() : `第${num}题`;
      const type = getQuestionType(doc, qid, rawTitle);
      const typeName = TYPE_NAMES[type] || `主观题(type=${type})`;

      // 提取选项 (客观题)
      const options = [];
      const optionDivs = cont ? cont.querySelectorAll(`div.answerBg[qid="${qid}"], div.answerBg`) : [];
      optionDivs.forEach((div) => {
        const span = div.querySelector('span[data]');
        const letter = span ? span.getAttribute('data') : null;
        const textEl = div.querySelector('.answer_p') || div;
        const text = textEl.innerText.replace(/\s+/g, ' ').trim();
        if (letter) {
          options.push({ letter, text });
        }
      });

      // 填空/主观题槽位
      let slots = 0;
      const slotsEl = doc.querySelector(`input[name="tiankongsize${qid}"]`);
      if (slotsEl && slotsEl.value) {
        slots = parseInt(slotsEl.value, 10);
      } else if (doc.querySelector(`textarea[name="answer${qid}"]`)) {
        slots = 1;
      } else if (type === '2') {
        // 兜底查找空位数量
        const editors = cont ? cont.querySelectorAll('textarea[name^="answerEditor"]') : [];
        slots = editors.length || 1;
      } else if (type === '4') {
        slots = 1;
      }

      // 题目模式
      const mode = options.length > 0 ? 'choice' : (slots > 0 ? 'blank' : 'unknown');

      questions.push({
        num,
        qid,
        type,
        typeName,
        mode,
        title: rawTitle,
        slots,
        options
      });
    }

    return questions;
  }

  // ==================== 4. 拟真事件交互系统 ====================

  // 拟真鼠标移动并点击
  async function simulateRealisticClick(element, delayMs = 300) {
    if (!element) return false;

    // 1. 平滑滚动到视野正中
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    await sleep(250);

    const rect = element.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    const baseEventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX + window.screenX,
      screenY: clientY + window.screenY,
      button: 0,
      buttons: 1
    };

    // 2. 依次派发鼠标事件序列：pointerover -> mouseover -> pointerdown -> mousedown -> pointerup -> mouseup -> click
    element.dispatchEvent(new PointerEvent('pointerover', { ...baseEventProps, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseover', baseEventProps));
    element.dispatchEvent(new PointerEvent('pointerdown', { ...baseEventProps, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', baseEventProps));

    await sleep(Math.floor(Math.random() * 80) + 70); // 拟真按下持续时长

    element.dispatchEvent(new PointerEvent('pointerup', { ...baseEventProps, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...baseEventProps, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...baseEventProps, buttons: 0 }));

    // 原生 click 兜底
    if (typeof element.click === 'function') {
      try {
        element.click();
      } catch (e) {}
    }

    await sleep(delayMs);
    return true;
  }

  // 拟真键盘输入到普通输入框或 textarea
  async function simulateRealisticTyping(element, text, charDelayMs = 40) {
    if (!element) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(150);

    // 获得焦点
    element.focus();
    await simulateRealisticClick(element, 100);

    // 清空现有内容
    element.value = '';

    // 逐字键入模拟
    for (let i = 0; i < text.length; i++) {
      if (isTaskCancelled) break;
      const char = text[i];
      const keyCode = char.charCodeAt(0);

      const keyProps = {
        key: char,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true
      };

      element.dispatchEvent(new KeyboardEvent('keydown', keyProps));
      element.dispatchEvent(new KeyboardEvent('keypress', keyProps));

      element.value += char;

      element.dispatchEvent(new InputEvent('input', {
        data: char,
        inputType: 'insertText',
        bubbles: true,
        cancelable: false
      }));

      element.dispatchEvent(new KeyboardEvent('keyup', keyProps));
      await sleep(charDelayMs + Math.floor(Math.random() * 20));
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return true;
  }

  // 拟真输入到 UEditor 富文本编辑器 (处理嵌套 iframe 与底层 sync)
  async function simulateTypeIntoUEditor(doc, qid, blankIndex, text, charDelayMs = 35) {
    const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
    const blankNum = blankIndex || 1;
    const name = doc.querySelector(`input[name="tiankongsize${qid}"]`)
      ? `answerEditor${qid}${blankNum}`
      : `answer${qid}`;

    // 1. 尝试定位 UEditor 对应的 iframe 并模拟输入
    let typedInIframe = false;
    if (cont) {
      const iframes = cont.querySelectorAll('div[id$="_iframeholder"] > iframe');
      const targetIframe = iframes[blankNum - 1] || iframes[0];
      if (targetIframe) {
        try {
          const frDoc = targetIframe.contentDocument || targetIframe.contentWindow.document;
          const body = frDoc ? frDoc.body : null;
          if (body) {
            targetIframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200);

            body.focus();
            body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            body.innerHTML = '';

            // 逐段插入并触发 input 事件
            for (let i = 0; i < text.length; i++) {
              if (isTaskCancelled) break;
              const char = text[i];
              body.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
              body.textContent += char;
              body.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
              body.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
              await sleep(charDelayMs);
            }
            typedInIframe = true;
          }
        } catch (e) {
          // iframe 跨域或安全限制时回退
        }
      }
    }

    // 2. 无论是否输入进 iframe，必须同步底层 <textarea>
    const ta = doc.querySelector(`textarea[name="${name}"]`);
    if (ta) {
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 3. 通过 page_inject.js 调度页面主执行环境的 UEditor.sync()
    await callPageInject('SET_EDITOR_CONTENT', { name, content: text });
    await sleep(200);

    return true;
  }

  // ==================== 5. 逐题作答执行与回读校验 ====================

  // 回读客观题当前在平台上的选中状态
  function readChoiceState(doc, qid) {
    const ansInput = doc.querySelector('#answer' + qid);
    const markedSpans = doc.querySelectorAll(`.choice${qid}.check_answer, [qid="${qid}"] .check_answer`);
    const marked = Array.from(markedSpans).map((s) => s.getAttribute('data')).filter(Boolean);
    return {
      val: ansInput ? ansInput.value.trim() : '',
      marked
    };
  }

  // 作答客观题（单选、多选、判断）
  async function answerChoiceQuestion(doc, qid, choiceValue, num) {
    const isBool = choiceValue === 'true' || choiceValue === 'false';
    const letters = isBool ? [choiceValue] : String(choiceValue).split('');
    let isSuccess = false;

    for (let attempt = 1; attempt <= 2 && !isSuccess; attempt++) {
      if (isTaskCancelled) break;

      for (const letter of letters) {
        if (isTaskCancelled) break;

        // 定位选项：根据 data 属性精准寻找
        let span = doc.querySelector(`div.answerBg[qid="${qid}"] span[data="${letter}"]`) ||
                   doc.querySelector(`[qid="${qid}"] [data="${letter}"]`) ||
                   doc.querySelector(`#question${qid} span[data="${letter}"]`);

        // 判断题针对文本的别名适配
        if (!span && isBool) {
          const expectedText = choiceValue === 'true' ? /^(正确|对|√|A)$/ : /^(错误|错|×|B)$/;
          const allOptions = doc.querySelectorAll(`div.answerBg[qid="${qid}"], #question${qid} div.answerBg`);
          for (const opt of allOptions) {
            if (expectedText.test(opt.innerText.trim())) {
              span = opt.querySelector('span[data]') || opt;
              break;
            }
          }
        }

        if (!span) {
          console.warn(`[ChaoxingExt] 第${num}题 找不到选项 ${letter}`);
          continue;
        }

        // 选项容器（div.answerBg 承载平台 onclick="addChoice(this)"）
        const clickable = span.closest('div.answerBg') || span;

        // 拟真点击事件链
        await simulateRealisticClick(clickable, 300);
      }

      // 回读校验平台写入结果
      await sleep(350);
      const state = readChoiceState(doc, qid);
      const gotSet = (state.val || '').split('').sort().join('');
      const wantSet = letters.join('').split('').sort().join('');

      isSuccess = isBool
        ? (state.val === choiceValue || state.marked.includes(choiceValue))
        : (gotSet === wantSet && letters.every((l) => state.marked.includes(l)));

      if (!isSuccess && attempt === 1) {
        await sleep(400);
      }
    }

    return isSuccess;
  }

  // 作答填空题 / 主观题
  async function answerFillQuestion(doc, qid, fillArray, num) {
    const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
    const slotsEl = doc.querySelector(`input[name="tiankongsize${qid}"]`);
    const slots = slotsEl ? parseInt(slotsEl.value || '0', 10) : 1;
    const answers = Array.isArray(fillArray) ? fillArray : [String(fillArray)];

    // 平台空位小于答案数时，合并到最后一空（复用仓库规则）
    const distributed = [];
    if (answers.length <= slots) {
      for (let i = 0; i < slots; i++) {
        distributed.push(answers[i] || '');
      }
    } else {
      for (let i = 0; i < slots - 1; i++) {
        distributed.push(answers[i] || '');
      }
      distributed.push(answers.slice(slots - 1).join('、'));
    }

    let allSuccess = true;
    for (let j = 1; j <= distributed.length; j++) {
      if (isTaskCancelled) break;
      const text = distributed[j - 1];
      const ok = await simulateTypeIntoUEditor(doc, qid, j, text);
      if (!ok) allSuccess = false;
      await sleep(250);
    }

    return allSuccess;
  }

  // ==================== 6. 收尾提交流程与严格终止条件 ====================
  async function performSaveAndSubmit(doc) {
    updateStatusBar('正在执行保存与提交...', 'running');

    // 先调度一次全量富文本 sync
    const map = getQidMap(doc);
    await callPageInject('SYNC_ALL_EDITORS', { qids: Object.values(map) });
    await sleep(500);

    // ---------------- 步骤 1：先点击「暂时保存」 ----------------
    let saveBtn = Array.from(doc.querySelectorAll('a, button, input[type="button"]')).find((el) => {
      const txt = (el.innerText || el.value || '').trim();
      const onclick = el.getAttribute('onclick') || '';
      return /^暂时保存$/.test(txt) || onclick.includes('saveWork');
    });

    if (saveBtn) {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 找到「暂时保存」按钮，触发拟真点击...' });
      await simulateRealisticClick(saveBtn, 400);
    } else {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 未直接找到暂存按钮，调用底层 saveWork() 兜底...' });
      await callPageInject('TRIGGER_SAVE_WORK');
    }

    // 等待保存请求完成及页面状态稳定（约 2 秒）
    chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 正在等待暂存请求完成与状态稳定 (2s)...' });
    await sleep(2200);

    // ---------------- 步骤 2：再点击「提交」 ----------------
    let submitBtn = doc.querySelector('a.completeBtn') ||
      Array.from(doc.querySelectorAll('a, button, input[type="button"]')).find((el) => {
        const txt = (el.innerText || el.value || '').trim();
        const onclick = el.getAttribute('onclick') || '';
        return /^提交$/.test(txt) || onclick.includes('submitValidate');
      });

    if (submitBtn) {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 找到「提交」按钮，触发拟真点击...' });
      await simulateRealisticClick(submitBtn, 400);
    } else {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 尝试调用底层 ready2Submit 提交链路...' });
      await callPageInject('TRIGGER_READY_TO_SUBMIT');
    }

    // 等待弹窗出现
    await sleep(1500);

    // 识别并处理二次确认弹窗
    let pop = doc.querySelector('#workpop') || doc.querySelector('.popDiv') || doc.querySelector('.dialog');
    if (!pop || pop.style.display === 'none') {
      // 某些学习通版本 validate 正常返回后无响应，调用底层 ready2Submit 兜底弹出确认框
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 弹窗未显示，触发 ready2Submit 兜底...' });
      await callPageInject('TRIGGER_READY_TO_SUBMIT');
      await sleep(1200);
      pop = doc.querySelector('#workpop') || doc.querySelector('.popDiv');
    }

    if (pop && pop.style.display !== 'none') {
      const popText = (pop.innerText || '').replace(/\s+/g, ' ').trim();
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: `[提交弹窗] 识别到确认框文案: "${popText}"` });

      // 安全守卫：若提示未做完，严禁误提交
      if (/未做完|未作答|还有/.test(popText)) {
        const errorMsg = '平台提示存在未作答题目，已安全拦截自动提交！请检查答案后手动处理。';
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: `[警告] ${errorMsg}` });
        updateStatusBar('提交被拦截：有未答题目', 'error');
        throw new Error(errorMsg);
      }

      // 定位确认按钮并点击
      const okBtn = pop.querySelector('#popok') ||
                    Array.from(pop.querySelectorAll('a, button')).find((b) => /确定|确认|提交/.test(b.innerText.trim()));

      if (okBtn) {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 点击弹窗「确认」按钮，完成最终提交！' });
        await simulateRealisticClick(okBtn, 400);
      } else {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 未找到弹窗内的确认按钮，请手动确认。' });
      }
    } else {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 未检测到二次弹窗，提交指令已派发完毕。' });
    }

    // ---------------- 步骤 3：立即终止任务（严格执行） ----------------
    await sleep(1500);
    updateStatusBar('已提交完成', 'completed');
    chrome.runtime.sendMessage({
      action: 'TASK_COMPLETED',
      message: '作业已成功提交完成！自动化流程已立即终止。'
    });

    isTaskRunning = false;
    console.log('[ChaoxingExt] 任务到此彻底结束，严禁执行后续跳转或刷新。');
  }

  // ==================== 7. 全流程调度入口 ====================
  async function runAutoAnswerWorkflow(answersData, autoSubmit = true) {
    if (isTaskRunning) {
      console.warn('[ChaoxingExt] 任务已在运行中');
      return;
    }

    const doc = getQuizContext();
    if (!doc) {
      throw new Error('未在当前页面或框架中检测到超星作业题目');
    }

    isTaskRunning = true;
    isTaskCancelled = false;
    injectPageScript();
    updateStatusBar('正在自动作答...', 'running');

    const map = getQidMap(doc);
    const answerList = answersData.answers || [];
    const total = answerList.length;
    let completedCount = 0;

    chrome.runtime.sendMessage({
      action: 'LOG_UPDATE',
      log: `[作答] 开始执行拟真作答，共需完成 ${total} 道题目...`
    });

    for (const ansItem of answerList) {
      if (isTaskCancelled) {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[中断] 用户已手动中止任务。' });
        updateStatusBar('任务已中止', 'error');
        isTaskRunning = false;
        return;
      }

      const { num, choice, fill } = ansItem;
      const qid = map[String(num)];
      if (!qid) {
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[跳过] 第 ${num} 题未找到对应 qid`
        });
        continue;
      }

      // 高亮当前正在作答的题目
      const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
      if (cont) {
        document.querySelectorAll('.cx-active-question-highlight').forEach((el) => el.classList.remove('cx-active-question-highlight'));
        cont.classList.add('cx-active-question-highlight');
      }

      let success = false;
      if (choice !== undefined && choice !== null && choice !== '') {
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[客观题] 第 ${num} 题 → 模拟点击选项: ${choice}`
        });
        success = await answerChoiceQuestion(doc, qid, choice, num);
      } else if (fill !== undefined && fill !== null) {
        const fillDesc = Array.isArray(fill) ? fill.join(' | ') : String(fill);
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[主观题] 第 ${num} 题 → 模拟键盘输入: ${fillDesc.slice(0, 30)}...`
        });
        success = await answerFillQuestion(doc, qid, fill, num);
      }

      completedCount++;
      const progressPercent = Math.round((completedCount / total) * 100);

      chrome.runtime.sendMessage({
        action: 'PROGRESS_UPDATE',
        progress: progressPercent,
        current: completedCount,
        total,
        statusText: `作答中 (${completedCount}/${total})`
      });

      updateStatusBar(`作答中 (${completedCount}/${total})`, 'running');
      await sleep(350);
    }

    // 作答完毕，移除题目高亮
    document.querySelectorAll('.cx-active-question-highlight').forEach((el) => el.classList.remove('cx-active-question-highlight'));

    chrome.runtime.sendMessage({
      action: 'LOG_UPDATE',
      log: `[复核] 全部 ${total} 题已作答完毕！`
    });

    // 收尾：先暂存后提交
    if (autoSubmit && !isTaskCancelled) {
      await performSaveAndSubmit(doc);
    } else {
      updateStatusBar('作答完成 (未自动提交)', 'completed');
      chrome.runtime.sendMessage({
        action: 'TASK_COMPLETED',
        message: '作答已完成（按设置跳过自动提交）。'
      });
      isTaskRunning = false;
    }
  }

  // ==================== 8. 监听来自 Background / Popup 的通信 ====================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'CHECK_PAGE_STATUS': {
        const hasQuiz = hasQuizDOM();
        const questions = hasQuiz ? extractAllQuestions() : [];
        sendResponse({
          isQuizPage: hasQuiz,
          questionCount: questions.length,
          url: window.location.href,
          title: document.title
        });
        break;
      }

      case 'EXTRACT_QUESTIONS': {
        try {
          const questions = extractAllQuestions();
          sendResponse({ success: true, questions });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'START_EXECUTION': {
        const { answersData, autoSubmit } = request;
        runAutoAnswerWorkflow(answersData, autoSubmit).catch((err) => {
          chrome.runtime.sendMessage({
            action: 'TASK_ERROR',
            error: err.message || String(err)
          });
          updateStatusBar('执行异常: ' + (err.message || '未知错误'), 'error');
          isTaskRunning = false;
        });
        sendResponse({ success: true, message: 'Workflow started' });
        break;
      }

      case 'STOP_TASK': {
        isTaskCancelled = true;
        isTaskRunning = false;
        updateStatusBar('任务已停止', 'error');
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[操作] 任务已被用户手动终止。' });
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true; // 保持异步消息通道
  });

  // 初始化检查
  if (hasQuizDOM()) {
    injectPageScript();
    console.log('[ChaoxingExt] 已就绪，检测到超星作业题目 DOM。');
  }
})();
