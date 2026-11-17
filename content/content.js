// content.js: 运行在超星学习通页面各 Frame 中的内容脚本 (Manifest V3 - v1.0.1)
// 职责：严格单 Frame 独立工作、DOM 题目抽取清洗（公式/图片支持）、强绑定 qid、差集拟真点击、高效 UEditor 写入与安全提交
(function () {
  'use strict';

  let isTaskRunning = false;
  let isTaskCancelled = false;
  let BRIDGE_TOKEN = '';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ==================== 1. Frame 守卫与 DOM 检测 ====================
  function hasOwnQuizDOM(doc = document) {
    if (!doc) return false;
    return Boolean(
      doc.querySelector('div.questionLi[id^="question"], [id^="question"][data], h3.mark_name')
    );
  }

  function getQuizContext() {
    if (hasOwnQuizDOM(document)) {
      return { doc: document, win: window };
    }
    return null;
  }

  // ==================== 2. 浮动状态条 UI（仅在持有题目的 Frame 挂载） ====================
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
    if (!hasOwnQuizDOM(document)) return;
    const bar = getOrCreateStatusBar();
    bar.className = state;
    const statusText = bar.querySelector('.cx-status-text');
    if (statusText) statusText.textContent = text;
  }

  // ==================== 3. 注入 Page Script 桥接（携带随机 Token） ====================
  function injectPageScript() {
    if (!hasOwnQuizDOM(document)) return;
    if (document.getElementById('cx-quiz-injected-script')) return;
    try {
      BRIDGE_TOKEN = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Math.random()).slice(2) + Date.now().toString(36);

      const script = document.createElement('script');
      script.id = 'cx-quiz-injected-script';
      script.src = chrome.runtime.getURL('content/page_inject.js');
      script.dataset.bridgeToken = BRIDGE_TOKEN;
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[ChaoxingExt] Page script injection failed:', e);
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
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'CHAOXING_QUIZ_EXT_PAGE') return;
        if (BRIDGE_TOKEN && event.data.token !== BRIDGE_TOKEN) return;
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
        token: BRIDGE_TOKEN,
        requestId
      }, '*');
    });
  }

  // ==================== 4. 富文本抽取（图片与公式占位） ====================
  function extractRichText(element) {
    if (!element) return { text: '', hasImage: false };
    const clone = element.cloneNode(true);
    let hasImage = false;

    const images = clone.querySelectorAll('img');
    images.forEach((img) => {
      hasImage = true;
      const latex = img.getAttribute('data-latex') || img.alt;
      const src = img.getAttribute('src') || '';
      const replacement = latex
        ? `[公式/图片: ${latex}]`
        : `[图片: ${src.slice(-40) || 'image'}]`;
      img.replaceWith(document.createTextNode(replacement));
    });

    const text = clone.innerText ? clone.innerText.replace(/\s+/g, ' ').trim() : '';
    return { text, hasImage };
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

    if (Object.keys(map).length === 0) {
      const qElements = doc.querySelectorAll('div.questionLi[id^="question"]');
      qElements.forEach((el, idx) => {
        const qid = el.id.replace('question', '').trim();
        map[String(idx + 1)] = qid;
      });
    }

    return map;
  }

  function getQuestionType(doc, qid, titleText = '') {
    const typeInput = doc.querySelector('#answertype' + qid);
    if (typeInput && typeInput.value !== undefined && typeInput.value !== '') {
      return String(typeInput.value);
    }
    if (/单选题/.test(titleText)) return '0';
    if (/多选题/.test(titleText)) return '1';
    if (/填空题/.test(titleText)) return '2';
    if (/判断题/.test(titleText)) return '3';
    if (/简答题|解答题|论述题|名词解释|计算题/.test(titleText)) return '4';
    return '0';
  }

  // 抽取整页题目结构
  function extractAllQuestions() {
    const doc = document;
    if (!hasOwnQuizDOM(doc)) return [];

    const map = getQidMap(doc);
    const TYPE_NAMES = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' };
    const questions = [];

    const sortedEntries = Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));

    for (const [numStr, qid] of sortedEntries) {
      const num = parseInt(numStr, 10);
      const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
      const h3 = cont ? cont.querySelector('h3.mark_name') : null;

      const { text: rawTitle, hasImage: titleHasImg } = h3 ? extractRichText(h3) : { text: `第${num}题`, hasImage: false };
      let itemHasImage = titleHasImg;

      const type = getQuestionType(doc, qid, rawTitle);
      const typeName = TYPE_NAMES[type] || `主观题(type=${type})`;

      // 提取客观题选项
      const options = [];
      const optionDivs = cont ? cont.querySelectorAll(`div.answerBg[qid="${qid}"], div.answerBg`) : [];
      optionDivs.forEach((div) => {
        const span = div.querySelector('span[data]');
        const letter = span ? span.getAttribute('data') : null;
        const textEl = div.querySelector('.answer_p') || div;
        const { text: optText, hasImage: optHasImg } = extractRichText(textEl);
        if (optHasImg) itemHasImage = true;
        if (letter) {
          options.push({ letter, text: optText });
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
        const editors = cont ? cont.querySelectorAll('textarea[name^="answerEditor"]') : [];
        slots = editors.length || 1;
      } else if (type === '4') {
        slots = 1;
      }

      const mode = options.length > 0 ? 'choice' : (slots > 0 ? 'blank' : 'unknown');

      if (itemHasImage) {
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `⚠️ 第 ${num} 题包含图片或公式，建议交卷前人工复核`
        }).catch(() => {});
      }

      questions.push({
        qid: String(qid),
        num,
        type,
        typeName,
        mode,
        title: rawTitle,
        slots,
        slotCount: slots,
        options,
        hasImage: itemHasImage
      });
    }

    return questions;
  }

  // ==================== 5. 拟真事件交互系统 ====================
  async function simulateRealisticClick(element, delayMs = 300) {
    if (!element) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    await sleep(220);

    const rect = element.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    const baseEventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX + (window.screenX || 0),
      screenY: clientY + (window.screenY || 0),
      button: 0,
      buttons: 1
    };

    element.dispatchEvent(new PointerEvent('pointerover', { ...baseEventProps, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseover', baseEventProps));
    element.dispatchEvent(new PointerEvent('pointerdown', { ...baseEventProps, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', baseEventProps));

    await sleep(Math.floor(Math.random() * 60) + 60);

    element.dispatchEvent(new PointerEvent('pointerup', { ...baseEventProps, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...baseEventProps, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...baseEventProps, buttons: 0 }));

    if (typeof element.click === 'function') {
      try { element.click(); } catch (e) {}
    }

    await sleep(delayMs);
    return true;
  }

  // ==================== 6. 客观题（基于差集的状态翻转点击） ====================
  function getSelectedLettersSet(doc, qid) {
    const selected = new Set();
    const ansInput = doc.querySelector('#answer' + qid);
    if (ansInput && ansInput.value) {
      const rawVal = ansInput.value.trim();
      if (rawVal === 'true' || rawVal === 'false') {
        selected.add(rawVal);
      } else {
        rawVal.split('').forEach((c) => selected.add(c.toUpperCase()));
      }
    }

    // 检查激活标记
    const activeSpans = doc.querySelectorAll(`.choice${qid}.check_answer, [qid="${qid}"] .check_answer, [qid="${qid}"] .check_answer_dx, #question${qid} .check_answer`);
    activeSpans.forEach((span) => {
      const data = span.getAttribute('data');
      if (data) selected.add(data);
    });

    return selected;
  }

  function setsAreEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  async function answerChoiceQuestion(doc, qid, choiceValue, num) {
    const isBool = choiceValue === 'true' || choiceValue === 'false';
    const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
    const typeEl = doc.querySelector('#answertype' + qid);
    const qType = typeEl ? String(typeEl.value) : (isBool ? '3' : '0');

    // 收集题目内的全部可选字母
    const allOptionDivs = cont ? cont.querySelectorAll(`div.answerBg[qid="${qid}"], div.answerBg`) : [];
    const allOptionLetters = [];
    allOptionDivs.forEach((div) => {
      const span = div.querySelector('span[data]');
      if (span && span.getAttribute('data')) {
        allOptionLetters.push(span.getAttribute('data'));
      }
    });

    // 目标集合
    let targetSet = new Set();
    if (isBool) {
      const hasBoolData = allOptionLetters.includes('true') || allOptionLetters.includes('false');
      if (hasBoolData) {
        targetSet.add(choiceValue);
      } else {
        targetSet.add(choiceValue === 'true' ? 'A' : 'B');
      }
    } else {
      String(choiceValue).replace(/[^A-Za-z]/g, '').toUpperCase().split('').forEach((l) => targetSet.add(l));
    }

    let isSuccess = false;

    for (let attempt = 1; attempt <= 3 && !isSuccess; attempt++) {
      if (isTaskCancelled) break;

      const currentSet = getSelectedLettersSet(doc, qid);
      const matchesTarget = (isBool && (currentSet.has(choiceValue) || (choiceValue === 'true' && currentSet.has('A')) || (choiceValue === 'false' && currentSet.has('B'))))
        || setsAreEqual(currentSet, targetSet);

      if (matchesTarget) {
        isSuccess = true;
        break;
      }

      if (qType === '1' || targetSet.size > 1) {
        // 多选题：计算差集，多选的取消，少选的补选，已选对的绝不重复点击
        const toClick = allOptionLetters.filter((letter) => targetSet.has(letter) !== currentSet.has(letter));
        for (const letter of toClick) {
          if (isTaskCancelled) break;
          const span = doc.querySelector(`div.answerBg[qid="${qid}"] span[data="${letter}"]`) ||
                       doc.querySelector(`[qid="${qid}"] [data="${letter}"]`) ||
                       doc.querySelector(`#question${qid} span[data="${letter}"]`);
          const clickable = span ? (span.closest('div.answerBg') || span) : null;
          if (clickable) {
            await simulateRealisticClick(clickable, 260);
          }
        }
      } else {
        // 单选 / 判断题
        for (const targetLetter of targetSet) {
          if (!currentSet.has(targetLetter)) {
            let span = doc.querySelector(`div.answerBg[qid="${qid}"] span[data="${targetLetter}"]`) ||
                       doc.querySelector(`[qid="${qid}"] [data="${targetLetter}"]`) ||
                       doc.querySelector(`#question${qid} span[data="${targetLetter}"]`);
            if (!span && isBool) {
              const expectedText = choiceValue === 'true' ? /^(正确|对|√|A)$/ : /^(错误|错|×|B)$/;
              for (const opt of allOptionDivs) {
                if (expectedText.test(opt.innerText.trim())) {
                  span = opt.querySelector('span[data]') || opt;
                  break;
                }
              }
            }
            const clickable = span ? (span.closest('div.answerBg') || span) : null;
            if (clickable) {
              await simulateRealisticClick(clickable, 300);
            }
          }
        }
      }

      await sleep(350);
      const afterSet = getSelectedLettersSet(doc, qid);
      const verified = (isBool && (afterSet.has(choiceValue) || (choiceValue === 'true' && afterSet.has('A')) || (choiceValue === 'false' && afterSet.has('B'))))
        || setsAreEqual(afterSet, targetSet);
      if (verified) {
        isSuccess = true;
        break;
      }
    }

    return isSuccess;
  }

  // ==================== 7. 主观与填空题（UEditor setContent + 自动切分） ====================
  async function simulateTypeIntoUEditor(doc, qid, blankIndex, text) {
    if (isTaskCancelled) return false;

    const blankNum = blankIndex || 1;
    const name = doc.querySelector(`input[name="tiankongsize${qid}"]`)
      ? `answerEditor${qid}${blankNum}`
      : `answer${qid}`;

    const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
    if (cont) {
      const holder = cont.querySelector('div[id$="_iframeholder"]') || cont;
      holder.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(180);
    }

    // 通过 page_inject.js 执行安全的 HTML 实体转义与 setContent()
    const res = await callPageInject('SET_EDITOR_CONTENT', { name, content: text });

    // 普通输入框兜底
    const ta = doc.querySelector(`textarea[name="${name}"], input[name="${name}"]`);
    if (ta) {
      ta.value = String(text ?? '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    await sleep(200);
    return Boolean(res && res.success !== false);
  }

  async function answerFillQuestion(doc, qid, fillArray, num) {
    const slotsEl = doc.querySelector(`input[name="tiankongsize${qid}"]`);
    const slotCount = slotsEl ? parseInt(slotsEl.value || '0', 10) : 1;
    let answers = Array.isArray(fillArray) ? fillArray.map(String) : [String(fillArray)];

    // 若 AI 把多个空的答案合并为一个字符串且平台有多个空，按常见分隔符自动切分
    if (answers.length === 1 && slotCount > 1) {
      const rawStr = answers[0];
      const splitArr = rawStr.split(/\s*(?:[,，;；、/|]|\s{2,})\s*/).filter(Boolean);
      if (splitArr.length > 1) {
        answers = splitArr;
      }
    }

    if (answers.length < slotCount) {
      chrome.runtime.sendMessage({
        action: 'LOG_UPDATE',
        log: `⚠️ 第 ${num} 题填空槽位数(${slotCount})多于 AI 返回答案数(${answers.length})`
      }).catch(() => {});
    }

    // 按平台空位数对齐
    const distributed = [];
    if (answers.length <= slotCount) {
      for (let i = 0; i < slotCount; i++) {
        distributed.push(answers[i] || '');
      }
    } else {
      for (let i = 0; i < slotCount - 1; i++) {
        distributed.push(answers[i] || '');
      }
      distributed.push(answers.slice(slotCount - 1).join('、'));
    }

    let allSuccess = true;
    for (let j = 1; j <= distributed.length; j++) {
      if (isTaskCancelled) break;
      const ok = await simulateTypeIntoUEditor(doc, qid, j, distributed[j - 1]);
      if (!ok) allSuccess = false;
      await sleep(150);
    }

    return allSuccess;
  }

  // ==================== 8. 收尾提交流程 ====================
  async function performSaveAndSubmit(doc) {
    updateStatusBar('正在执行保存与提交...', 'running');

    const map = getQidMap(doc);
    await callPageInject('SYNC_ALL_EDITORS', { qids: Object.values(map) });
    await sleep(400);

    // 1. 暂时保存
    let saveBtn = Array.from(doc.querySelectorAll('a, button, input[type="button"]')).find((el) => {
      const txt = (el.innerText || el.value || '').trim();
      const onclick = el.getAttribute('onclick') || '';
      return /^暂时保存$/.test(txt) || onclick.includes('saveWork');
    });

    if (saveBtn) {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 找到「暂时保存」按钮，触发拟真点击...' });
      await simulateRealisticClick(saveBtn, 400);
    } else {
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 调用底层 saveWork() 兜底...' });
      await callPageInject('TRIGGER_SAVE_WORK');
    }

    chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[暂存] 正在等待暂存完成 (2s)...' });
    await sleep(2200);

    // 2. 提交
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
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 调用底层 ready2Submit 提交链路...' });
      await callPageInject('TRIGGER_READY_TO_SUBMIT');
    }

    await sleep(1500);

    // 3. 弹窗识别与安全拦截
    let pop = doc.querySelector('#workpop') || doc.querySelector('.popDiv') || doc.querySelector('.dialog');
    if (!pop || pop.style.display === 'none') {
      await callPageInject('TRIGGER_READY_TO_SUBMIT');
      await sleep(1200);
      pop = doc.querySelector('#workpop') || doc.querySelector('.popDiv');
    }

    if (pop && pop.style.display !== 'none') {
      const popText = (pop.innerText || '').replace(/\s+/g, ' ').trim();
      chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: `[提交弹窗] 识别到确认框文案: "${popText}"` });

      if (/未做完|未作答|还有/.test(popText)) {
        const errorMsg = '平台提示存在未作答题目，已安全拦截自动提交！请检查后手动处理。';
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: `[警告] ${errorMsg}` });
        updateStatusBar('提交被拦截：有未答题目', 'error');
        throw new Error(errorMsg);
      }

      const okBtn = pop.querySelector('#popok') ||
                    Array.from(pop.querySelectorAll('a, button')).find((b) => /确定|确认|提交/.test(b.innerText.trim()));

      if (okBtn) {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[提交] 点击确认按钮，完成最终提交！' });
        await simulateRealisticClick(okBtn, 400);
      }
    }

    // 4. 立即终止
    await sleep(1500);
    updateStatusBar('已提交完成', 'completed');
    chrome.runtime.sendMessage({
      action: 'TASK_COMPLETED',
      message: '作业已成功提交完成！自动化流程已立即终止。'
    });

    isTaskRunning = false;
  }

  // ==================== 9. 全流程调度执行（强绑定 qid） ====================
  async function runAutoAnswerWorkflow(answersData, autoSubmit = true) {
    if (isTaskRunning) return;

    const ctx = getQuizContext();
    if (!ctx) throw new Error('未在当前 Frame 检测到超星题目');
    const doc = ctx.doc;

    isTaskRunning = true;
    isTaskCancelled = false;
    injectPageScript();
    updateStatusBar('正在自动作答...', 'running');

    const allQuestions = extractAllQuestions();
    const answerList = answersData.answers || [];
    const total = allQuestions.length;
    let completedCount = 0;

    chrome.runtime.sendMessage({
      action: 'LOG_UPDATE',
      log: `[作答] 开始执行拟真作答，共需完成 ${total} 道题目...`
    });

    for (const question of allQuestions) {
      if (isTaskCancelled) {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', log: '[中断] 用户已手动中止任务。' });
        updateStatusBar('任务已中止', 'error');
        isTaskRunning = false;
        return;
      }

      const qid = String(question.qid);
      const num = question.num;

      // 强绑定 qid 优先匹配
      const ansItem = answerList.find((a) => String(a.qid) === qid) ||
                      answerList.find((a) => Number(a.num) === Number(num));

      if (!ansItem) {
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[跳过] 第 ${num} 题 (qid=${qid}) 在 AI 答案表中缺失`
        });
        continue;
      }

      const cont = doc.querySelector('#question' + qid) || doc.querySelector(`[data="${qid}"]`);
      if (cont) {
        document.querySelectorAll('.cx-active-question-highlight').forEach((el) => el.classList.remove('cx-active-question-highlight'));
        cont.classList.add('cx-active-question-highlight');
      }

      const { choice, fill } = ansItem;

      if (choice !== undefined && choice !== null && choice !== '') {
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[客观题] 第 ${num} 题 → 拟真点击选项: ${choice}`
        });
        await answerChoiceQuestion(doc, qid, choice, num);
      } else if (fill !== undefined && fill !== null) {
        const fillDesc = Array.isArray(fill) ? fill.join(' | ') : String(fill);
        chrome.runtime.sendMessage({
          action: 'LOG_UPDATE',
          log: `[主观题] 第 ${num} 题 → UEditor 写入: ${fillDesc.slice(0, 30)}...`
        });
        await answerFillQuestion(doc, qid, fill, num);
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
      await sleep(250);
    }

    document.querySelectorAll('.cx-active-question-highlight').forEach((el) => el.classList.remove('cx-active-question-highlight'));

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

  // ==================== 10. 消息监听守卫（关键：无题目 Frame 绝不回应） ====================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 停止任务允许直接中断
    if (request.action === 'STOP_TASK') {
      isTaskCancelled = true;
      isTaskRunning = false;
      updateStatusBar('任务已停止', 'error');
      sendResponse({ success: true });
      return false;
    }

    // 其余业务消息：若当前 Frame 不持有题目 DOM，坚决不回应，让真正持题 Frame 响应
    if (!hasOwnQuizDOM(document)) {
      return false;
    }

    switch (request.action) {
      case 'CHECK_PAGE_STATUS': {
        const questions = extractAllQuestions();
        sendResponse({
          isQuizPage: true,
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

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });

  // 初始化：若持有题目则就绪
  if (hasOwnQuizDOM(document)) {
    injectPageScript();
    console.log('[ChaoxingExt v1.0.1] 当前 Frame 持有超星题目 DOM，初始化就绪。');
  }
})();
