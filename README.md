# Byfu - Zero-Footprint Anti-Detection and LMS Shield

Byfu is an advanced, high-performance browser extension built on Manifest V3 designed for zero-footprint browser anti-detection, anti-fingerprinting, and Learning Management System (LMS) restriction neutralization. 

By executing directly within the page's execution context (`MAIN` world) at `document_start`, Byfu intercepts and sanitizes telemetry, tracking hooks, hardware queries, canvas fingerprinting vectors, and execution freezes before target web applications can detect or enforce monitoring constraints.

---

## Architectural Overview

Byfu operates through a multi-tier architecture that decouples privileged background management from main-world DOM runtime hooks, ensuring zero DOM pollution and complete isolation from page-level inspection.

```
+-----------------------------------------------------------------------+
|                             Browser Engine                            |
+-----------------------------------------------------------------------+
        |                                                   |
        v (document_start, allFrames)                       v (document_start, allFrames)
+------------------------------------+             +--------------------+
|             MAIN World             |             |   ISOLATED World   |
|             (main.js)              |             |     (relay.js)     |
| - Prototype Hooking & Proxies      |             | - Capturing Phase  |
| - Stack Scrubbing & CallSite Spoofer|             | - Event Bridge     |
| - Hardware & WebGL Spoofing        |             |                    |
| - Deterministic Canvas Noise       |             +---------+----------+
| - Event & Anti-Debugger Interceptor|                       |
+-----------------+------------------+                       |
                  |                                          |
                  +--- Handshake & Port (MessageChannel) ----+
                                                             |
                                                             | chrome.runtime.sendMessage
                                                             v
                                           +------------------------------------+
                                           |      Background Service Worker     |
                                           |          (background.js)           |
                                           | - Persistent Runtime State         |
                                           | - Debounced Stats & Tab Logs       |
                                           | - Debounced Atomic Stats Batching  |
                                           | - Bounded Ring-Buffer Tab Logging  |
                                           +-----------------+------------------+
                                                             |
                                           +-----------------+------------------+
                                           |                                    |
                                           v                                    v
                                  +------------------+                +-------------------+
                                  |     Popup UI     |                |  Dashboard Page   |
                                  | (popup.html/.js) |                | (dash.html/.js)   |
                                  +------------------+                +-------------------+
```

---

## Key Features & Capabilities

### 1. Prototype Defense and Stack Trace Sanitization
* **Universal `toString` Spoofing**: All function proxies and getter overrides are marked using an unexposed, memory-safe `WeakSet`. The global `Function.prototype.toString` is intercepted to dynamically return standard native code representations (`function <name>() { [native code] }`), completely resisting reflection attacks and property enumeration.
* **V8 `CallSite` Sanitization**: Proxies the `Error.prepareStackTrace` setter to sanitize raw V8 `CallSite` objects before passing them to application telemetry frameworks (e.g., Sentry, Datadog), preventing leakages of extension script URLs (`chrome-extension://`, `moz-extension://`) while maintaining host page observability.
* **Stack String Cleansing**: Sanitizes the `stack` property across error instances to scrub internal extension stack frames during runtime exceptions.
* **Native Function Caching**: Critical primitive routines (`Reflect.apply`, `String.prototype.split`, `Array.prototype.filter`, etc.) are captured immediately at initialization, protecting internal execution logic against prototype pollution or DOM clobbering.

### 2. Page Visibility and Focus Emulation
* **Visibility State Override**: Overrides `document.hidden` (and vendor variants `webkitHidden`, `mozHidden`, `msHidden`) to consistently return `false`. Overrides `document.visibilityState` (and vendor variants) to consistently report `'visible'`.
* **Focus State Emulation**: Forces `document.hasFocus()` to return `true` unconditionally, preventing tab-switch and blur detection mechanisms.

### 3. Fullscreen API Neutralization
* **Simulated Fullscreen State**: Overrides `document.fullscreenElement`, `document.fullscreenEnabled`, and prefixed variants (`webkitFullscreenElement`, `mozFullScreenElement`, etc.) to simulate active fullscreen status at all times.
* **No-Op Fullscreen Actions**: Intercepts `requestFullscreen` and `exitFullscreen` on `Element.prototype` and `Document.prototype`, resolving immediately with a fulfilled `Promise` without triggering layout shifts or browser UI prompts.

### 4. Hardware and Environmental Fingerprint Spoofing
* **Navigator Parameter Normalization**: Normalizes `navigator.webdriver` to `false`, and sets `navigator.hardwareConcurrency` and `navigator.deviceMemory` to standard baseline values (`8`).
* **WebGL Vendor and Renderer Masking**: Overrides `WebGLRenderingContext.prototype.getParameter` and `WebGL2RenderingContext.prototype.getParameter` to mask graphics hardware queries (`UNMASKED_VENDOR_WEBGL` -> `Google Inc. (Apple)`, `UNMASKED_RENDERER_WEBGL` -> `ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)`).

### 5. Canvas Anti-Fingerprinting (Non-Destructive & Deterministic)
* **Uniformity and Blank Canvas Detection**: Incorporates an `isUniformOrBlank` fast-path verification. Solid color fills (e.g., `#000000` integrity probes) and empty canvases remain untouched to avoid failing anti-tampering heuristics.
* **Deterministic Pseudo-Random Noise**: Applies discrete ±1 LSB modifications across RGB channels based on a mathematical hash derived from pixel coordinates, canvas dimensions, and a session salt.
* **Canvas Paradox Resolution**: Consecutive readouts (such as `toDataURL` or `toBlob`) on identical canvases return identical checksums, defeating double-hash detection techniques.
* **Offscreen Buffer Transformation**: Renders noise onto an isolated offscreen canvas instance during export calls, leaving the live DOM canvas element and rendering pipeline unmodified.

### 6. Event Suppression and LMS Restriction Bypass
* **Telemetry Event Blocking**: Intercepts `EventTarget.prototype.addEventListener` and suppresses tracking events: `visibilitychange`, `blur`, `focusout`, `pagehide`, `pageshow`, `fullscreenchange`, and `pointerlockchange`.
* **Symmetrical Listener Management**: Implements bidirectional mapping via `WeakMap` to support transparent registration and deregistration using `removeEventListener`.
* **Inline Event Handler Hooking**: Proxies `on*` property accessors across `Window`, `Document`, and `HTMLElement` prototypes to maintain getter/setter reference transparency while neutralizing event dispatches.
* **Interaction Restriction Bypass**: Neutralizes `Event.prototype.preventDefault` on protected user interaction events (`copy`, `paste`, `cut`, `contextmenu`, `selectstart`, `dragstart`), bypassing exam/quiz lockout mechanisms.

### 7. Anti-Debugger Neutralization
* **Dynamic Code Execution Sanitization**: Intercepts `window.Function`, `eval`, `setInterval`, and `setTimeout` to scrub and neutralize `debugger;` statements in runtime-evaluated scripts, preventing execution-freeze loops.

### 8. Deep Frame and IFrame Hardening
* **Dynamic IFrame Protection**: Intercepts `HTMLIFrameElement.prototype.contentWindow` and `HTMLIFrameElement.prototype.contentDocument` to automatically propagate stealth shields to dynamically injected or nested frame contexts.

### 9. Web Worker Anti-Detection and CSP Resilience
* **Worker Execution Injection**: Wraps `Worker` initialization with an embedded stealth initialization payload via `Blob` and `data:` URI construction.
* **Strict CSP Fallback Engine**: If strict Content Security Policy directives (such as `worker-src 'self'`) reject dynamic URI schemes, Byfu gracefully constructs the standard Worker and proxies `addEventListener` / `onmessage` to sanitize outgoing telemetry messages, preventing worker denial-of-service crashes while preserving privacy.

### 10. High-Performance Extension Core
* **Static Content Script Lifecycle**: Declares `main.js` and `relay.js` statically in `manifest.json`, removing service-worker registration races and keeping the page injection lifecycle owned by Chrome.
* **Runtime State Synchronization**: Stores the enabled state in `chrome.storage.local`; the isolated relay observes state changes and forwards them to the MAIN-world runtime without requiring script unregister/register cycles or page reloads.
* **Debounced Atomic Storage I/O**: Batches statistical tracking updates in memory with debounced flushes to prevent storage concurrency overhead.
* **Zero-Footprint Event Bridge**: Uses a private `MessageChannel` with a dynamic token handshake during the DOM capturing phase to communicate telemetry from `MAIN` to `ISOLATED` without global identifiers or window properties.

---

## File Structure

```
byfu/
├── manifest.json       # Manifest V3 configuration and permissions
├── background.js       # Background service worker with mutex queue and storage batching
├── main.js             # Main-world stealth engine, prototype hooks, and fingerprinters
├── relay.js            # Isolated-world capturing-phase communication relay
├── popup.html          # Extension popup user interface
├── popup.css           # Styling for popup and base window controls
├── popup.js            # Controller for popup view and real-time tab logs
├── dashboard.html      # Standalone full-page analytics dashboard
├── dashboard.css       # Layout and styles for dashboard view
├── dashboard.js        # Controller for dashboard metrics and state synchronization
├── img/
│   ├── logo.png        # Extension icon asset
│   └── byfu.png        # Extension branding asset
├── LICENSE             # Project license
└── README.md           # Technical documentation
```

---

## Installation and Development

### Loading the Extension in Developer Mode
1. Clone or download the repository to your local system:
   ```bash
   git clone https://github.com/Anhdeface/byfu.git
   ```
2. Open Google Chrome or any Chromium-based browser (Brave, Edge, Opera).
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode** via the toggle switch in the upper-right corner.
5. Click **Load unpacked** and select the root directory of the project (`byfu`).

### Verification
* Open the browser Developer Tools on any website.
* Verify that `navigator.webdriver` evaluates to `false`.
* Verify that `document.hidden` evaluates to `false` and `document.visibilityState` evaluates to `'visible'`.
* Open the Byfu popup or dashboard to monitor active protection logs and execution counts.

---

## Technical Specifications

| Parameter | Specification |
|:---|:---|
| Extension Platform | Manifest V3 |
| Target Execution Worlds | `MAIN` (Core hooks) & `ISOLATED` (Relay bridge) |
| Script Injection Timing | `document_start` |
| Frame Coverage | All frames (`allFrames: true`) |
| Required Permissions | `storage` |
| Host Permissions | `<all_urls>` |
| Storage Architecture | `chrome.storage.local` with debounced write batching |
| Memory Management | Ring buffer (bounded to 200 logs per active tab) |

---

## License

This project is licensed under the terms defined in the [LICENSE](file:///home/quanh/Documents/byfu/LICENSE) file.
