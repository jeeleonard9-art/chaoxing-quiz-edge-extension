// popup.js: 弹出面板控制交互逻辑 (支持中英双语动态切换)
document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素引用
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
  const eyeIcon = document.getElementById('eyeIcon');
  const modelSelect = document.getElementById('modelSelect');
  const tempInput = document.getElementById('tempInput');
  const autoSubmitCheck = document.getElementById('autoSubmitCheck');
  const testConnBtn = document.getElementById('testConnBtn');
  const testResultTip = document.getElementById('testResult');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const progressStep = document.getElementById('progressStep');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  const logConsole = document.getElementById('logConsole');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const pageStatusBadge = document.getElementById('pageStatusBadge');
  const pageStatusText = document.getElementById('pageStatusText');
  const langToggleBtn = document.getElementById('langToggleBtn');

  let currentActiveTabId = null;
  let currentLang = 'zh';

  // ==================== 1. 双语国际化词典 (i18n) ====================
  const I18N = {
    zh: {
      appTitle: '学习通答题助手',
      statusDetecting: '检测中...',
      configTitle: '大模型 API 配置',
      autoSaved: '已自动保存',
      apiUrlLabel: 'API Base URL',
      apiUrlHint: '兼容 OpenAI 规范 /v1 格式或自定义代理中转接口',
      apiKeyLabel: 'API Key',
      modelLabel: '模型名称 (Model)',
      tempLabel: '温度 (Temp)',
      autoSubmitLabel: '答题后自动「暂时保存」并确认提交',
      testBtn: '测试连接',
      waitingCommand: '等待指令',
      startBtn: '开始自动答题',
      stopBtn: '停止',
      consoleTitle: '执行控制台',
      clearLogs: '清空',
      welcomeLog: '[就绪] 欢迎使用超星学习通全自动答题插件。',
      consoleCleared: '[控制台已清空]',
      notChaoxingPage: '非超星页面',
      noQuizDetected: '未检测到题目',
      quizDetected: (count) => `已识别 ${count} 道题`,
      notInQuizArea: '非作业作答区',
      emptyKeyAlert: '请先输入有效的 API Key！',
      emptyTabAlert: '未获取到当前活动标签页！',
      testingConnection: '正在测试连接...',
      connSuccess: (model) => `连接成功: ${model} 响应正常`,
      connFailed: '连接失败'
    },
    en: {
      appTitle: 'Chaoxing Quiz Auto',
      statusDetecting: 'Detecting...',
      configTitle: 'LLM API Settings',
      autoSaved: 'Auto-saved',
      apiUrlLabel: 'API Base URL',
      apiUrlHint: 'OpenAI-compatible /v1 format or custom reverse proxies',
      apiKeyLabel: 'API Key',
      modelLabel: 'Model Name',
      tempLabel: 'Temperature',
      autoSubmitLabel: 'Auto "Save Draft" & Submit after quiz completion',
      testBtn: 'Test Connection',
      waitingCommand: 'Waiting for command',
      startBtn: 'Start Auto-Answer',
      stopBtn: 'Stop',
      consoleTitle: 'Execution Console',
      clearLogs: 'Clear',
      welcomeLog: '[Ready] Welcome to Chaoxing Quiz Auto Edge Assistant.',
      consoleCleared: '[Console cleared]',
      notChaoxingPage: 'Not Chaoxing page',
      noQuizDetected: 'No questions found',
      quizDetected: (count) => `Found ${count} questions`,
      notInQuizArea: 'Not in quiz area',
      emptyKeyAlert: 'Please provide a valid API Key first!',
      emptyTabAlert: 'No active browser tab found!',
      testingConnection: 'Testing connection...',
      connSuccess: (model) => `Success: ${model} is responsive`,
      connFailed: 'Connection failed'
    }
  };

  function applyLanguage(lang) {
    currentLang = lang;
    langToggleBtn.textContent = lang === 'zh' ? 'EN' : '中文';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (I18N[lang] && I18N[lang][key] && typeof I18N[lang][key] === 'string') {
        el.textContent = I18N[lang][key];
      }
    });
    chrome.storage.local.set({ appLang: lang });
  }

  langToggleBtn.addEventListener('click', () => {
    applyLanguage(currentLang === 'zh' ? 'en' : 'zh');
    checkCurrentTab();
  });

  // ==================== 2. 配置加载与自动持久化 ====================
  const DEFAULT_CONFIG = {
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'Agnes-3.0-flash',
    temperature: 0.2,
    autoSubmit: true,
    appLang: 'zh'
  };

  chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
    apiUrlInput.value = stored.apiUrl || DEFAULT_CONFIG.apiUrl;
    apiKeyInput.value = stored.apiKey || '';
    modelSelect.value = stored.model || DEFAULT_CONFIG.model;
    tempInput.value = stored.temperature !== undefined ? stored.temperature : DEFAULT_CONFIG.temperature;
    autoSubmitCheck.checked = stored.autoSubmit !== undefined ? stored.autoSubmit : DEFAULT_CONFIG.autoSubmit;
    applyLanguage(stored.appLang || 'zh');
  });

  function saveConfig() {
    const configToSave = {
      apiUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value.trim() || 'Agnes-3.0-flash',
      temperature: parseFloat(tempInput.value) || 0.2,
      autoSubmit: autoSubmitCheck.checked,
      appLang: currentLang
    };
    chrome.storage.local.set(configToSave);
  }

  [apiUrlInput, apiKeyInput, modelSelect, tempInput, autoSubmitCheck].forEach((input) => {
    input.addEventListener('input', saveConfig);
    input.addEventListener('change', saveConfig);
  });

  // ==================== 3. API Key 明文/掩码切换 ====================
  let isKeyVisible = false;
  toggleKeyBtn.addEventListener('click', () => {
    isKeyVisible = !isKeyVisible;
    apiKeyInput.type = isKeyVisible ? 'text' : 'password';
    eyeIcon.innerHTML = isKeyVisible
      ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  });

  // ==================== 4. 日志渲染与控制台 ====================
  function appendLog(line) {
    const div = document.createElement('div');
    div.className = 'log-line';
    if (/\[完成\]|成功|✓|Success|Completed/i.test(line)) {
      div.classList.add('log-success');
    } else if (/\[错误\]|\[异常\]|失败|✗|Error|Failed/i.test(line)) {
      div.classList.add('log-error');
    } else if (/\[AI推理\]|\[作答\]|AI|Answering/i.test(line)) {
      div.classList.add('log-highlight');
    }
    div.textContent = line;
    logConsole.appendChild(div);
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  clearLogBtn.addEventListener('click', () => {
    logConsole.innerHTML = `<div class="log-line text-muted">${I18N[currentLang].consoleCleared}</div>`;
    chrome.runtime.sendMessage({ action: 'CLEAR_LOGS' });
  });

  // ==================== 5. 检查当前标签页作业状态 ====================
  async function checkCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      currentActiveTabId = tab.id;

      if (!tab.url || (!tab.url.includes('chaoxing.com') && !tab.url.includes('xuexi365.net') && !tab.url.includes('edu.cn'))) {
        pageStatusBadge.className = 'status-badge badge-warning';
        pageStatusText.textContent = I18N[currentLang].notChaoxingPage;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          pageStatusBadge.className = 'status-badge badge-warning';
          pageStatusText.textContent = I18N[currentLang].noQuizDetected;
        } else if (res.isQuizPage) {
          pageStatusBadge.className = 'status-badge badge-success';
          pageStatusText.textContent = I18N[currentLang].quizDetected(res.questionCount);
        } else {
          pageStatusBadge.className = 'status-badge badge-warning';
          pageStatusText.textContent = I18N[currentLang].notInQuizArea;
        }
      });
    } catch (e) {
      console.warn('Tab check failed:', e);
    }
  }

  // ==================== 6. 测试 API 连接 ====================
  testConnBtn.addEventListener('click', async () => {
    const config = {
      baseUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value.trim() || 'Agnes-3.0-flash'
    };

    if (!config.apiKey) {
      testResultTip.className = 'test-result-tip error';
      testResultTip.textContent = I18N[currentLang].emptyKeyAlert;
      return;
    }

    testConnBtn.disabled = true;
    testResultTip.className = 'test-result-tip';
    testResultTip.textContent = I18N[currentLang].testingConnection;

    chrome.runtime.sendMessage({ action: 'TEST_CONNECTION', config }, (res) => {
      testConnBtn.disabled = false;
      if (chrome.runtime.lastError) {
        testResultTip.className = 'test-result-tip error';
        testResultTip.textContent = 'ServiceWorker: ' + chrome.runtime.lastError.message;
        return;
      }

      if (res && res.success) {
        testResultTip.className = 'test-result-tip success';
        testResultTip.textContent = I18N[currentLang].connSuccess(res.data.model);
        appendLog(`[测试/Test] OK: ${res.data.model}`);
      } else {
        testResultTip.className = 'test-result-tip error';
        testResultTip.textContent = (res && res.error) ? res.error : I18N[currentLang].connFailed;
        appendLog(`[测试/Test] ERR: ${(res && res.error) ? res.error : 'Unknown'}`);
      }
    });
  });

  // ==================== 7. 开始自动答题与停止 ====================
  startBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      alert(I18N[currentLang].emptyKeyAlert);
      apiKeyInput.focus();
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      alert(I18N[currentLang].emptyTabAlert);
      return;
    }
    const tab = tabs[0];
    currentActiveTabId = tab.id;

    const config = {
      baseUrl: apiUrlInput.value.trim(),
      apiKey: apiKey,
      model: modelSelect.value.trim() || 'Agnes-3.0-flash',
      temperature: parseFloat(tempInput.value) || 0.2,
      autoSubmit: autoSubmitCheck.checked
    };

    startBtn.disabled = true;
    stopBtn.disabled = false;

    chrome.runtime.sendMessage({
      action: 'START_TASK_FLOW',
      tabId: tab.id,
      config
    }, (res) => {
      if (chrome.runtime.lastError) {
        appendLog(`[错误/Error] ${chrome.runtime.lastError.message}`);
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    });
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    if (currentActiveTabId) {
      chrome.tabs.sendMessage(currentActiveTabId, { action: 'STOP_TASK' }).catch(() => {});
    }
    chrome.runtime.sendMessage({ action: 'STOP_TASK' }).catch(() => {});
    startBtn.disabled = false;
  });

  // ==================== 8. 同步后台状态与实时推送 ====================
  function updateUIWithState(state) {
    if (!state) return;
    if (state.isRunning) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }

    progressStep.textContent = state.statusText || I18N[currentLang].waitingCommand;
    const percent = Math.min(100, Math.max(0, state.progress || 0));
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  }

  // 接收实时推送
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'LOG_BROADCAST') {
      appendLog(msg.log);
    } else if (msg.action === 'STATE_BROADCAST') {
      updateUIWithState(msg.state);
    }
  });

  // 打开弹窗时拉取后台当前状态和历史日志
  chrome.runtime.sendMessage({ action: 'GET_TASK_STATE' }, (res) => {
    if (res && res.success && res.state) {
      updateUIWithState(res.state);
      if (Array.isArray(res.state.logs) && res.state.logs.length > 0) {
        logConsole.innerHTML = '';
        res.state.logs.forEach(appendLog);
      }
    }
  });

  checkCurrentTab();
});
