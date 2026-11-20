/**
 * WAllie - RElinked: Background Service Worker
 * Fetches OpenGraph metadata directly in the browser, bypassing CORS restrictions with Discordbot User-Agent.
 */

const PREVIEW_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CRAWLER_USER_AGENT = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function extractMetaContent(html, propertyName, isName = false) {
  const attr = isName ? 'name' : 'property';
  const escapedProp = escapeRegex(propertyName);

  const r1 = new RegExp(
    `<meta\\s+[^>]*?\\b${attr}\\s*=\\s*(?:["']${escapedProp}["']|${escapedProp}(?=[\\s>]))[^>]*?\\bcontent\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );
  const m1 = html.match(r1);
  if (m1) {
    const val = m1[1] !== undefined ? m1[1] : m1[2] !== undefined ? m1[2] : m1[3];
    if (val !== undefined && val.trim()) return decodeHtmlEntities(val.trim());
  }

  const r2 = new RegExp(
    `<meta\\s+[^>]*?\\bcontent\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))[^>]*?\\b${attr}\\s*=\\s*(?:["']${escapedProp}["']|${escapedProp}(?=[\\s>]))`,
    'i'
  );
  const m2 = html.match(r2);
  if (m2) {
    const val = m2[1] !== undefined ? m2[1] : m2[2] !== undefined ? m2[2] : m2[3];
    if (val !== undefined && val.trim()) return decodeHtmlEntities(val.trim());
  }

  return null;
}

function extractLinkHref(html, relType) {
  const escapedRel = escapeRegex(relType);
  const r = new RegExp(
    `<link\\s+[^>]*?\\brel\\s*=\\s*["'][^"']*?${escapedRel}[^"']*?["'][^>]*?\\bhref\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );
  const m = html.match(r);
  if (m) {
    const val = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (val !== undefined && val.trim()) return decodeHtmlEntities(val.trim());
  }
  return null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m && m[1] ? decodeHtmlEntities(m[1].trim()) : null;
}

async function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function processImage(imageBlob) {
  try {
    const bitmap = await createImageBitmap(imageBlob);
    const origW = bitmap.width;
    const origH = bitmap.height;
    if (origW <= 0 || origH <= 0) return null;

    const MAX_MICRO_DIM = 140;
    const microRatio = Math.min(1, Math.min(MAX_MICRO_DIM / origW, MAX_MICRO_DIM / origH));
    const microW = Math.max(1, Math.round(origW * microRatio));
    const microH = Math.max(1, Math.round(origH * microRatio));

    const microCanvas = new OffscreenCanvas(microW, microH);
    const microCtx = microCanvas.getContext('2d');
    if (!microCtx) return null;
    microCtx.drawImage(bitmap, 0, 0, microW, microH);

    const microBlob = await microCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
    const thumbnailBase64 = await arrayBufferToBase64(await microBlob.arrayBuffer());

    if (origW < 200 || origH < 150) {
      return { thumbnailBase64 };
    }

    const MAX_HQ_DIM = 1024;
    const hqRatio = Math.min(1, Math.min(MAX_HQ_DIM / origW, MAX_HQ_DIM / origH));
    const hqW = Math.max(1, Math.round(origW * hqRatio));
    const hqH = Math.max(1, Math.round(origH * hqRatio));

    const hqCanvas = new OffscreenCanvas(hqW, hqH);
    const hqCtx = hqCanvas.getContext('2d');
    if (!hqCtx) return { thumbnailBase64 };
    hqCtx.drawImage(bitmap, 0, 0, hqW, hqH);

    const hqBlob = await hqCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const thumbnailHQBase64 = await arrayBufferToBase64(await hqBlob.arrayBuffer());

    return {
      thumbnailBase64,
      thumbnailHQBase64,
      width: hqW,
      height: hqH
    };
  } catch (e) {
    console.warn('[link-previews] Failed to process image:', e);
    return null;
  }
}

async function fetchLinkPreviewInternal(targetUrl) {
  const cached = PREVIEW_CACHE.get(targetUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': CRAWLER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();
    const title =
      extractMetaContent(html, 'og:title') ||
      extractMetaContent(html, 'twitter:title') ||
      extractTitle(html);
    const description =
      extractMetaContent(html, 'og:description') ||
      extractMetaContent(html, 'twitter:description') ||
      extractMetaContent(html, 'description', true);

    let imageUrl =
      extractMetaContent(html, 'og:image:secure_url') ||
      extractMetaContent(html, 'og:image') ||
      extractMetaContent(html, 'twitter:image') ||
      extractLinkHref(html, 'image_src') ||
      extractLinkHref(html, 'apple-touch-icon') ||
      extractLinkHref(html, 'icon');

    if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      try {
        imageUrl = new URL(imageUrl, targetUrl).toString();
      } catch {
        imageUrl = null;
      }
    }

    let processedImage = null;
    if (imageUrl) {
      try {
        const imgController = new AbortController();
        const imgTimeout = setTimeout(() => imgController.abort(), 4000);
        const imgRes = await fetch(imageUrl, {
          signal: imgController.signal,
          headers: { 'User-Agent': CRAWLER_USER_AGENT }
        });
        clearTimeout(imgTimeout);
        if (imgRes.ok) {
          processedImage = await processImage(await imgRes.blob());
        }
      } catch {}
    }

    if (!title && !description) return null;

    const data = {
      title: title || '',
      description: description || '',
      previewType: 'link',
      thumbnailBase64: processedImage?.thumbnailBase64,
      thumbnailHQBase64: processedImage?.thumbnailHQBase64,
      thumbnailWidth: processedImage?.width,
      thumbnailHeight: processedImage?.height
    };

    PREVIEW_CACHE.set(targetUrl, { data, timestamp: Date.now() });
    return data;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'FETCH_LINK_PREVIEW') {
    chrome.storage.local.get(['enabled'], async (settings) => {
      if (settings.enabled === false) {
        sendResponse({ preview: null });
        return;
      }
      sendResponse({ preview: await fetchLinkPreviewInternal(request.url) });
    });
    return true;
  }

  if (request.type === 'CLEAR_CACHE') {
    PREVIEW_CACHE.clear();
    chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_PREVIEW_CACHE' }).catch(() => {});
        }
      }
    });
    sendResponse({ success: true });
    return false;
  }

  if (request.type === 'GET_CACHE_COUNT') {
    sendResponse({ count: PREVIEW_CACHE.size });
    return false;
  }
});
