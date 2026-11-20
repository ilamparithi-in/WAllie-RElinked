/**
 * WAllie - RElinked: Popup Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-enabled');
  const statusBadge = document.getElementById('status-badge');
  const cacheCountEl = document.getElementById('cache-count');
  const clearBtn = document.getElementById('clear-cache-btn');

  function updateStatusUI(enabled) {
    if (statusBadge) {
      statusBadge.textContent = enabled ? 'Active' : 'Disabled';
      statusBadge.className = `badge ${enabled ? 'badge-active' : 'badge-disabled'}`;
    }
    if (toggle) toggle.checked = enabled;
  }

  chrome.storage?.local?.get?.(['enabled'], (res) => {
    updateStatusUI(res?.enabled !== false);
  });

  chrome.runtime?.sendMessage?.({ type: 'GET_CACHE_COUNT' }, (res) => {
    if (cacheCountEl && res && typeof res.count === 'number') {
      cacheCountEl.textContent = `${res.count} ${res.count === 1 ? 'item' : 'items'} in memory`;
    }
  });

  toggle?.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage?.local?.set?.({ enabled: isEnabled });
    updateStatusUI(isEnabled);
  });

  clearBtn?.addEventListener('click', () => {
    if (clearBtn.disabled) return;
    clearBtn.disabled = true;
    const originalText = clearBtn.innerHTML;
    clearBtn.innerHTML = '<span>Clearing...</span>';

    chrome.runtime?.sendMessage?.({ type: 'CLEAR_CACHE' }, () => {
      if (cacheCountEl) cacheCountEl.textContent = '0 items in memory';
      clearBtn.innerHTML = '<span>Cleared!</span>';
      setTimeout(() => {
        clearBtn.innerHTML = originalText;
        clearBtn.disabled = false;
      }, 1500);
    });
  });
});
