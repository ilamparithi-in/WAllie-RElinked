/**
 * WAllie - RElinked: Content Script Bridge (Isolated World)
 * Injects main-world hook script and bridges messaging with the background worker.
 */

function injectMainWorld() {
  if (document.getElementById('wa-link-preview-main-world')) return;
  try {
    const script = document.createElement('script');
    script.id = 'wa-link-preview-main-world';
    script.src = chrome.runtime.getURL('scripts/mainWorld.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (err) {
    console.warn('[link-preview-ext] Failed to inject mainWorld.js:', err);
  }
}

injectMainWorld();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMainWorld, { once: true });
}

window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'WA_LP_CLEAR_CACHE') {
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, (res) => {
        window.postMessage({ type: 'WA_LP_CLEAR_CACHE_RES', success: res?.success }, '*');
      });
    } catch {}
    return;
  }
  if (event.data.type === 'WA_LP_REQ') {
    const { requestId, url } = event.data;
    try {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_LINK_PREVIEW',
          url
        },
        (res) => {
          window.postMessage(
            {
              type: 'WA_LP_RES',
              requestId,
              preview: res?.preview || null
            },
            '*'
          );
        }
      );
    } catch {
      window.postMessage(
        {
          type: 'WA_LP_RES',
          requestId,
          preview: null
        },
        '*'
      );
    }
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'CLEAR_PREVIEW_CACHE') {
    window.postMessage({ type: 'CLEAR_WA_LINK_PREVIEW_CACHE' }, '*');
  }
});
