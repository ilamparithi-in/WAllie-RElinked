# WAllie - RElinked

> **Instant OpenGraph link previews for WhatsApp Web without phone timeouts.**  
> *Reverse-engineered client-side preview scraper built as a Chromium Manifest V3 extension.*

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Target: WhatsApp Web](https://img.shields.io/badge/Target-WhatsApp%20Web-25D366.svg)](https://web.whatsapp.com)


## The Problem

When typing a link into official WhatsApp Web, WhatsApp does not scrape the website from your desktop. Instead, it dispatches an asynchronous Signal protocol message to your **primary phone**, expecting the mobile OS to fetch the OpenGraph metadata and stream it back.

If your primary mobile device is:
- Temporarily offline or in an area with poor connectivity,
- Experiencing background app limits or battery optimizations,
- In repair, discharged, or unreachable,

WhatsApp Web waits **7 full seconds** before timing out, leaving your message with a bare, preview-less link.

## The Solution: Reverse Engineered

**WAllie - RElinked** reverse-engineers WhatsApp Web's internal webpack architecture (`WAWebLinkPreviewChatAction.getLinkPreview`) directly in the browser. 

When you paste or type a URL:
1. **Local Fetch**: Scrapes OpenGraph tags (`og:title`, `og:description`, `og:image`) immediately from your desktop browser.
2. **Instant Feedback**: No 7-second timeouts; previews generate within milliseconds.
3. **MMS Parity**: Converts preview images into WhatsApp's native high-resolution MMS thumbnail cards via WhatsApp's media pipelines (`WAWebMediaUploadMmsThumbnail`).
4. **100% Client-Side**: No third-party proxy, tracking server, or remote backend. All requests originate directly from your local browser environment.


## Features

- ⚡ **Zero Phone Dependency**: Bypasses the 7-second mobile resolver timeout entirely.
- 🖼️ **Rich OpenGraph & Twitter Cards**: Extracts titles, descriptions, and high-definition banners with entity decoding.
- 💾 **In-Memory LRU Cache**: Avoids duplicate scraping when typing or editing messages.
- 🎛️ **Options & Cache Control**: Built-in popup interface to toggle features and flush the preview cache on demand.
- 🔒 **Privacy Focused**: No middleman analytics, logging, or third-party servers.


## How It Works

1. **Content Script Bridge (`scripts/contentBridge.js`)**: Runs at `document_start` in the isolated extension world, securely injecting the main-world hook and mediating message exchange.
2. **Main-World Hook (`scripts/mainWorld.js`)**: Runs directly in WhatsApp Web's execution realm to intercept `WAWebLinkPreviewChatAction.getLinkPreview`.
3. **Background Service Worker (`scripts/background.js`)**: Handles cross-origin HTTP fetches, parses HTML metadata, resamples thumbnail buffers, and caches resolved models.


## Installation

### Method A: Install in Google Chrome / Chromium / Brave / Edge (Unpacked)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/ilamparithi-in/WAllie-RElinked.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the cloned `WAllie-RElinked` directory.
5. Open [WhatsApp Web](https://web.whatsapp.com) and paste a link in any chat!

### Method B: Built into WAllie Desktop

If you use [WAllie (Unofficial Electron-based WhatsApp Client for Linux with Multi-account and Extensions Support)](https://github.com/ilamparithi-in/WAllie), this extension is bundled natively as an integrated built-in extension under **Settings &rarr; Extensions**.


## Technical Disclaimers

- **Network Exposure**: Generating previews locally causes your browser to make direct HTTP/HTTPS requests to the target URL's server. This reveals your device's IP address and browser headers to that website before sending the message (identical to how standard browser link previews work).
- **Desktop Parity Note**: Official WhatsApp Web runs inside a browser sandbox and cannot make cross-origin requests. WhatsApp Desktop for Windows works around this by using a native C++ Edge WebView2 bridge (`cr:17219.getWindowsBridge().linksPreview`) to scrape previews locally. This extension provides the equivalent bridge architecture on Chromium.


## Donate
Like my work? Consider buying me a Biriyani! [Donate](https://pseudosmp.github.io/donate)