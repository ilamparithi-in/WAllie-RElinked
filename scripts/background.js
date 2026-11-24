/**
 * WAllie - RElinked: Background Service Worker
 * Fetches OpenGraph metadata directly in the browser, bypassing CORS restrictions with Discordbot User-Agent.
 */

const PREVIEW_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CRAWLER_USER_AGENT = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const DNR_RULE_ID = 1001;
let dnrReady = false;

/**
 * Configure Declarative Net Request rules to enforce Discordbot User-Agent and strip
 * Client Hints (sec-ch-ua) for requests originating from this extension's service worker.
 * Excludes WhatsApp and Meta domains to safeguard WhatsApp Web's own session integrity.
 */
async function setupCrawlerUserAgentRule() {
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              {
                header: 'User-Agent',
                operation: 'set',
                value: CRAWLER_USER_AGENT
              },
              {
                header: 'sec-ch-ua',
                operation: 'remove'
              },
              {
                header: 'sec-ch-ua-mobile',
                operation: 'remove'
              },
              {
                header: 'sec-ch-ua-platform',
                operation: 'remove'
              }
            ]
          },
          condition: {
            urlFilter: '*',
            resourceTypes: ['xmlhttprequest', 'other'],
            excludedRequestDomains: [
              'whatsapp.com',
              'whatsapp.net',
              'facebook.com',
              'fbcdn.net',
              'meta.com'
            ]
          }
        }
      ]
    });
    dnrReady = true;
  } catch (err) {
    console.warn('[link-previews] Failed to register declarativeNetRequest rule:', err);
  }
}

setupCrawlerUserAgentRule();
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(setupCrawlerUserAgentRule);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  let res = str;
  for (let pass = 0; pass < 2; pass++) {
    const prev = res;
    res = res
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
          return String.fromCodePoint(parseInt(hex, 16));
        } catch {
          return '';
        }
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        try {
          return String.fromCodePoint(parseInt(dec, 10));
        } catch {
          return '';
        }
      });
    if (res === prev) break;
  }
  return res;
}

function extractMetaContent(html, propertyName) {
  const escapedProp = escapeRegex(propertyName);

  const r1 = new RegExp(
    `<meta\\s+[^>]*?\\b(?:property|name)\\s*=\\s*(?:["']${escapedProp}["']|${escapedProp}(?=[\\s>]))[^>]*?\\bcontent\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );
  const m1 = html.match(r1);
  if (m1) {
    const val = m1[1] !== undefined ? m1[1] : (m1[2] !== undefined ? m1[2] : m1[3]);
    if (val !== undefined && val.trim()) return decodeHtmlEntities(val.trim());
  }

  const r2 = new RegExp(
    `<meta\\s+[^>]*?\\bcontent\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))[^>]*?\\b(?:property|name)\\s*=\\s*(?:["']${escapedProp}["']|${escapedProp}(?=[\\s>]))`,
    'i'
  );
  const m2 = html.match(r2);
  if (m2) {
    const val = m2[1] !== undefined ? m2[1] : (m2[2] !== undefined ? m2[2] : m2[3]);
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
    const val = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
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

  if (!dnrReady) {
    await setupCrawlerUserAgentRule();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();

    // --- Universal Title Extraction ---
    const ogTitle = extractMetaContent(html, 'og:title');
    const twTitle = extractMetaContent(html, 'twitter:title');
    const docTitle = extractTitle(html);
    const siteName =
      extractMetaContent(html, 'og:site_name') ||
      extractMetaContent(html, 'application-name');

    let title = ogTitle || twTitle || docTitle;
    title = (title || '').replace(/\s+/g, ' ').trim();

    // If og:title or twitter:title is just the site name itself, prefer document title if it contains richer info
    if (
      siteName &&
      title &&
      docTitle &&
      title.toLowerCase() === siteName.toLowerCase() &&
      docTitle.toLowerCase() !== siteName.toLowerCase()
    ) {
      title = (docTitle || '').replace(/\s+/g, ' ').trim();
    }

    // Clean Reddit boilerplate prefixes & suffixes
    title = title.replace(/^From the\s+.*?\s+on\s+Reddit:\s*/i, '').trim();
    title = title.replace(/\s*[\-|\•\:]\s*Reddit$/i, '').trim();

    if (title && siteName) {
      const escapedSite = escapeRegex(siteName);
      // Clean prefix e.g. "From the ... on <SiteName>: Real Title"
      title = title.replace(new RegExp(`^From the\\s+.*?\\s+on\\s+${escapedSite}:\\s*`, 'i'), '').trim();
      // Clean suffix e.g. "Real Title - <SiteName>" or "Real Title | <SiteName>" or "Real Title: <SiteName>"
      const cleaned = title.replace(new RegExp(`\\s*[\\|\\-\\•\\:]\\s*${escapedSite}$`, 'i'), '').trim();
      if (cleaned) {
        title = cleaned;
      }
    }

    // --- Universal Description Extraction ---
    const ogDesc = extractMetaContent(html, 'og:description');
    const twDesc = extractMetaContent(html, 'twitter:description');
    const metaDesc = extractMetaContent(html, 'description');

    const cleanMeta = (metaDesc || '').replace(/\s+/g, ' ').trim();
    const cleanOg = (ogDesc || '').replace(/\s+/g, ' ').trim();
    const cleanTw = (twDesc || '').replace(/\s+/g, ' ').trim();

    let description = cleanOg || cleanTw || cleanMeta;

    // If og:description is boilerplate while standard description contains richer post text, prefer standard description
    if (cleanMeta && cleanOg && (cleanOg.toLowerCase().startsWith('explore this post') || cleanMeta.length > cleanOg.length)) {
      description = cleanMeta;
    }

    if (description) {
      // Clean forum/social stats prefix (e.g. "10K votes, 1K comments. Actual body text...")
      description = description.replace(/^[\d.,]+[kKmM]?\s+votes?,\s+[\d.,]+[kKmM]?\s+comments?\.\s*/i, '').trim();
    }

    if (!title && !description) return null;
    if (title && title.toLowerCase() === 'reddit' && !description) return null;

    title = (title || '').replace(/\s+/g, ' ').trim();
    description = (description || '').replace(/\s+/g, ' ').trim();

    let imageUrl =
      extractMetaContent(html, 'og:image:secure_url') ||
      extractMetaContent(html, 'og:image') ||
      extractMetaContent(html, 'twitter:image') ||
      extractMetaContent(html, 'twitter:image:src') ||
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
      const MAX_MEDIA_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_MEDIA_RETRIES; attempt++) {
        try {
          const imgController = new AbortController();
          const imgTimeout = setTimeout(() => imgController.abort(), 4000);
          const imgRes = await fetch(imageUrl, {
            signal: imgController.signal,
            headers: { 'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }
          });
          clearTimeout(imgTimeout);
          if (imgRes.ok) {
            processedImage = await processImage(await imgRes.blob());
            if (processedImage) break;
          }
        } catch {}
      }
    }

    const data = {
      title: title || '',
      description: description || '',
      previewType: 'link',
      thumbnailBase64: processedImage?.thumbnailBase64,
      thumbnailHQBase64: processedImage?.thumbnailHQBase64,
      thumbnailWidth: processedImage?.width,
      thumbnailHeight: processedImage?.height
    };

    if (!imageUrl || processedImage?.thumbnailBase64) {
      PREVIEW_CACHE.set(targetUrl, { data, timestamp: Date.now() });
    }
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
