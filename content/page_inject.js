// page_inject.js: 运行在宿主页面主执行上下文 (Main World)
// 用于直接与学习通前端框架、UEditor 实例以及全局函数进行无缝交互
(function () {
  'use strict';

  const EXT_SOURCE = 'CHAOXING_QUIZ_EXT_CONTENT';
  const PAGE_SOURCE = 'CHAOXING_QUIZ_EXT_PAGE';

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.source !== EXT_SOURCE) return;

    const { action, payload, requestId } = event.data;

    function reply(success, result, error) {
      window.postMessage({
        source: PAGE_SOURCE,
        requestId,
        success,
        result,
        error: error ? (error.message || String(error)) : null
      }, '*');
    }

    try {
      switch (action) {
        case 'PING_PAGE': {
          reply(true, {
            hasUE: typeof window.UE !== 'undefined',
            hasSaveWork: typeof window.saveWork === 'function',
            hasReady2Submit: typeof window.ready2Submit === 'function'
          });
          break;
        }

        case 'SET_EDITOR_CONTENT': {
          const { name, content } = payload;
          let ok = false;
          if (typeof window.UE !== 'undefined' && window.UE.getEditor) {
            try {
              const ed = window.UE.getEditor(name);
              if (ed) {
                ed.setContent(content || '');
                ed.sync();
                ok = true;
              }
            } catch (err) {
              console.warn('[PageInject] UE.getEditor error:', err);
            }
          }
          // 兜底同步 textarea
          const ta = document.querySelector(`textarea[name="${name}"]`);
          if (ta) {
            ta.value = content || '';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          }
          reply(true, { ok, name, content });
          break;
        }

        case 'SYNC_ALL_EDITORS': {
          const { qids } = payload;
          let syncedCount = 0;
          if (Array.isArray(qids)) {
            qids.forEach(q => {
              const typeEl = document.querySelector('#answertype' + q);
              const type = typeEl ? typeEl.value : null;
              const names = [];
              if (type === '2' || type === '9' || type === '10') {
                const sizeEl = document.querySelector(`input[name="tiankongsize${q}"]`);
                const n = parseInt(sizeEl ? sizeEl.value : '0', 10);
                for (let j = 1; j <= n; j++) {
                  names.push('answerEditor' + q + j);
                }
              } else {
                names.push('answer' + q);
              }

              names.forEach(name => {
                try {
                  if (typeof window.UE !== 'undefined' && window.UE.getEditor) {
                    const ed = window.UE.getEditor(name);
                    if (ed) {
                      ed.sync();
                      syncedCount++;
                    }
                  }
                } catch (e) {}
              });

              if (typeof window.syncAnswer === 'function') {
                try {
                  window.syncAnswer(q, type);
                } catch (e) {}
              }
            });
          }
          reply(true, { syncedCount });
          break;
        }

        case 'CALL_PAGE_METHOD': {
          const { methodName, args = [] } = payload;
          if (typeof window[methodName] === 'function') {
            try {
              const ret = window[methodName](...args);
              reply(true, { called: true, ret });
            } catch (err) {
              reply(false, null, err);
            }
          } else {
            reply(false, null, new Error(`Page method ${methodName} not found`));
          }
          break;
        }

        case 'TRIGGER_SAVE_WORK': {
          // 调用学习通底层的 saveWork(1) 或 saveWork()
          if (typeof window.saveWork === 'function') {
            try {
              window.saveWork(1);
              reply(true, { called: 'saveWork(1)' });
            } catch (err) {
              reply(false, null, err);
            }
          } else {
            reply(false, null, new Error('window.saveWork is not a function'));
          }
          break;
        }

        case 'TRIGGER_READY_TO_SUBMIT': {
          // 兜底触发 ready2Submit()
          if (typeof window.ready2Submit === 'function') {
            try {
              window.ready2Submit();
              reply(true, { called: 'ready2Submit()' });
            } catch (err) {
              reply(false, null, err);
            }
          } else if (typeof window.submitValidate === 'function') {
            try {
              window.submitValidate();
              reply(true, { called: 'submitValidate()' });
            } catch (err) {
              reply(false, null, err);
            }
          } else {
            reply(false, null, new Error('No submit trigger method found on page'));
          }
          break;
        }

        default:
          reply(false, null, new Error(`Unknown action: ${action}`));
      }
    } catch (err) {
      reply(false, null, err);
    }
  });

  // 告知 content_script 页面脚本注入就绪
  window.postMessage({ source: PAGE_SOURCE, action: 'INJECTED_READY' }, '*');
})();
