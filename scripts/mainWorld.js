/**
 * WAllie - RElinked: Main World Execution Context
 * Hooks WAWebLinkPreviewChatAction in WhatsApp Web's webpack context to provide instant OpenGraph rich previews.
 */

function requestPreviewFromBridge(url) {
  return new Promise((resolve) => {
    const requestId = 'lp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 6000);

    const handler = (evt) => {
      if (!evt.data || typeof evt.data !== 'object') return;
      if (evt.data.type === 'WA_LP_RES' && evt.data.requestId === requestId) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(evt.data.preview);
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'WA_LP_REQ', requestId, url }, '*');
  });
}

function initLinkPreview() {
  const tryHook = () => {
    try {
      if (typeof window.require !== 'function') return false;
      const linkAction = window.require('WAWebLinkPreviewChatAction');
      if (!linkAction || typeof linkAction.getLinkPreview !== 'function') return false;
      if (linkAction.getLinkPreview.__extHooked) return true;

      const originalGetLinkPreview = linkAction.getLinkPreview;
      const hooked = async function (e, _q) {
        if (e && e.url) {
          try {
            let previewCache;
            try {
              const linkPreviewCache = window.require('WAWebLinkPreviewCache');
              const chatGetters = window.require('WAWebChatGetters');
              const stateUtils = window.require('WAWebStateUtils');
              const unproxiedChat = _q && stateUtils?.unproxy ? stateUtils.unproxy(_q) : _q;
              const isNewsletter =
                unproxiedChat && chatGetters?.getIsNewsletter
                  ? chatGetters.getIsNewsletter(unproxiedChat)
                  : false;
              previewCache = isNewsletter
                ? linkPreviewCache?.getNewsletterPreviewCache?.()
                : linkPreviewCache?.getPreviewCache?.();
            } catch {}

            if (previewCache?.has(e.url)) {
              return previewCache.get(e.url);
            }

            const preview = await requestPreviewFromBridge(e.url);
            if (preview && (preview.title || preview.description)) {
              let mmsData = {};
              const hqBase64 = preview.thumbnailHQBase64;

              if (hqBase64 && typeof window.require === 'function') {
                try {
                  const opaqueData = window.require('WAWebMediaOpaqueData');
                  const uploadMms = window.require('WAWebMediaUploadMmsThumbnail');
                  const mediaTypes = window.require('WAWebMmsMediaTypes');
                  const randomKey = window.require('WAWebCryptoRandomMediaKey');
                  const constants = window.require('WAWebMediaConstants');
                  const getUploadOrigin = window.require('WAWebMediaGetUploadOriginForChat');
                  const chatGetters = window.require('WAWebChatGetters');

                  if (
                    opaqueData?.createFromBase64Jpeg &&
                    typeof uploadMms === 'function' &&
                    typeof randomKey === 'function'
                  ) {
                    const thumb = await opaqueData.createFromBase64Jpeg(hqBase64);
                    const isNewsletter =
                      _q && chatGetters?.getIsNewsletter ? chatGetters.getIsNewsletter(_q) : false;
                    const mediaType = isNewsletter
                      ? mediaTypes?.MEDIA_TYPES?.NEWSLETTER_THUMBNAIL_LINK
                      : mediaTypes?.MEDIA_TYPES?.THUMBNAIL_LINK;
                    const uploadOrigin =
                      typeof getUploadOrigin === 'function' ? getUploadOrigin(_q) : 1;

                    const mmsRes = await uploadMms({
                      thumbnail: thumb,
                      mediaType,
                      mediaKeyInfo: randomKey(),
                      uploadOrigin,
                      fileOrigin: null,
                      forwardedFromWeb: false,
                      timeout: constants?.MMS_THUMBNAIL_UPLOAD_TIMEOUT || 5000,
                      isViewOnce: false
                    });

                    if (mmsRes?.mediaEntry?.directPath) {
                      mmsData = {
                        thumbnailDirectPath: mmsRes.mediaEntry.directPath,
                        mediaKey: mmsRes.mediaEntry.mediaKey,
                        mediaKeyTimestamp: mmsRes.mediaEntry.mediaKeyTimestamp,
                        thumbnailSha256: mmsRes.filehash,
                        thumbnailEncSha256: mmsRes.mediaEntry.encFilehash
                      };
                    }
                  }
                } catch (mmsErr) {
                  console.warn(
                    '[link-previews] Standalone MMS thumbnail upload failed, falling back to inline thumbnail:',
                    mmsErr
                  );
                }
              }

              const result = {
                url: e.url,
                data: {
                  matchedText: e.url,
                  title: preview.title,
                  description: preview.description,
                  richPreviewType: preview.previewType === 'video' ? 1 : 0,
                  doNotPlayInline: false,
                  isLoading: false,
                  thumbnailHQ: hqBase64 || undefined,
                  thumbnail: preview.thumbnailBase64 || undefined,
                  thumbnailHeight: hqBase64 ? preview.thumbnailHeight : undefined,
                  thumbnailWidth: hqBase64 ? preview.thumbnailWidth : undefined,
                  ...mmsData
                }
              };

              previewCache?.set(e.url, result);
              return result;
            }
          } catch (err) {
            console.warn('[link-previews] Error generating standalone preview, falling back:', err);
          }
        }
        return originalGetLinkPreview.apply(this, arguments);
      };

      hooked.__extHooked = true;
      linkAction.getLinkPreview = hooked;
      return true;
    } catch {
      return false;
    }
  };

  if (!tryHook()) {
    const interval = setInterval(() => {
      if (tryHook()) clearInterval(interval);
    }, 500);
    setTimeout(() => clearInterval(interval), 60000);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'CLEAR_WA_LINK_PREVIEW_CACHE') {
      try {
        if (typeof window.require === 'function') {
          const linkPreviewCache = window.require('WAWebLinkPreviewCache');
          linkPreviewCache?.getPreviewCache?.()?.clear?.();
          linkPreviewCache?.getNewsletterPreviewCache?.()?.clear?.();
        }
      } catch {}
    }
  });
}

initLinkPreview();
