// ==UserScript==
// @name         byfu v7 (Stealth Proxy)
// @namespace    http://tampermonkey.net/
// @version      7.0.0
// @description  own evilst - Ultimate Stealth
// @author       evilst
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.__byfu_init) return; // Prevent double injection
    Object.defineProperty(window, '__byfu_init', { value: true, enumerable: false, writable: false });

    let filtersTriggered = false;
    const sendLog = (type, detail) => {
        if (type === 'blocked_event' || type === 'mutation_filtered' || type === 'success') {
            filtersTriggered = true;
        }
        try { window.postMessage({ from: "byfu_main", type: type, detail: detail }, "*"); } catch (e) { }
    };

    sendLog('usage_start', location.href);
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (!filtersTriggered) sendLog('info', 'No fingerprinting trackers detected on this site.');
        }, 4000);
    });

    function scrubStack(e) {
        if (e && e.stack && typeof e.stack === 'string') {
            e.stack = e.stack.split('\n')
                .filter(line => !line.includes('chrome-extension://') && !line.includes('moz-extension://'))
                .join('\n');
        }
        return e;
    }

    const proxiedObjects = new WeakMap();

    // Helper to proxy getter safely without modifying other descriptor flags
    function proxyGetter(obj, prop, handlerApply) {
        try {
            const desc = Object.getOwnPropertyDescriptor(obj, prop);
            if (!desc || !desc.get) return;
            const proxiedGet = new Proxy(desc.get, {
                apply(target, thisArg, args) {
                    try {
                        return handlerApply(target, thisArg, args);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                }
            });
            proxiedObjects.set(proxiedGet, desc.get);
            Object.defineProperty(obj, prop, { ...desc, get: proxiedGet });
        } catch (e) { }
    }

    // Helper to proxy function or constructor
    function proxyFunction(obj, prop, handlers) {
        try {
            const original = obj[prop];
            if (typeof original !== 'function') return;
            const safeHandlers = {};
            if (handlers.apply) {
                safeHandlers.apply = function (target, thisArg, args) {
                    try { return handlers.apply(target, thisArg, args); }
                    catch (e) { throw scrubStack(e); }
                };
            }
            if (handlers.construct) {
                safeHandlers.construct = function (target, args, newTarget) {
                    try { return handlers.construct(target, args, newTarget); }
                    catch (e) { throw scrubStack(e); }
                };
            }
            const p = new Proxy(original, safeHandlers);
            proxiedObjects.set(p, original);
            obj[prop] = p;
        } catch (e) { }
    }

    // =========================================================
    // 0. PERFECT TOSTRING SPOOFING
    // =========================================================
    const originalToString = Function.prototype.toString;
    const proxiedToString = new Proxy(originalToString, {
        apply(target, thisArg, args) {
            if (proxiedObjects.has(thisArg)) {
                return originalToString.call(proxiedObjects.get(thisArg));
            }
            if (thisArg === proxiedToString) {
                return originalToString.call(originalToString);
            }
            return originalToString.call(thisArg);
        }
    });
    Object.defineProperty(Function.prototype, 'toString', {
        value: proxiedToString,
        writable: true,
        configurable: true,
        enumerable: false
    });

    // =========================================================
    // 1. VISIBILITY / FOCUS
    // =========================================================
    proxyGetter(Document.prototype, 'hidden', () => false);
    proxyGetter(Document.prototype, 'visibilityState', () => 'visible');
    ['webkitHidden', 'mozHidden', 'msHidden'].forEach(prop => {
        proxyGetter(Document.prototype, prop, () => false);
    });
    proxyFunction(Document.prototype, 'hasFocus', { apply() { return true; } });

    // =========================================================
    // 2. FULLSCREEN – PROTOTYPE LEVEL
    // =========================================================
    ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach(p => {
        proxyGetter(Document.prototype, p, () => document.documentElement || document.body);
    });
    ['fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled'].forEach(p => {
        proxyGetter(Document.prototype, p, () => true);
    });

    // =========================================================
    // 3. WEBDRIVER + OUTER SIZE
    // =========================================================
    proxyGetter(Navigator.prototype, 'webdriver', () => undefined);
    proxyGetter(window, 'outerWidth', () => window.innerWidth);
    proxyGetter(window, 'outerHeight', () => window.innerHeight);

    // =========================================================
    // 4. CANVAS NOISE 
    // =========================================================
    function applyCanvasNoise(canvas) {
        if (canvas.width > 16 && canvas.height > 16 && !canvas.dataset.byfuTainted) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                // Consistent coordinate based on canvas dimensions to pass double-call tests
                const x = (canvas.width * 7) % Math.max(1, canvas.width - 1);
                const y = (canvas.height * 13) % Math.max(1, canvas.height - 1);
                ctx.fillStyle = 'rgba(0,0,0,0.004)';
                ctx.fillRect(x, y, 1, 1);
                canvas.dataset.byfuTainted = 'true';
                sendLog('success', 'Canvas consistent noise applied');
            }
        }
    }

    ['toDataURL', 'toBlob'].forEach(method => {
        proxyFunction(HTMLCanvasElement.prototype, method, {
            apply(target, thisArg, args) {
                applyCanvasNoise(thisArg);
                return Reflect.apply(target, thisArg, args);
            }
        });
    });

    proxyFunction(CanvasRenderingContext2D.prototype, 'getImageData', {
        apply(target, thisArg, args) {
            if (thisArg.canvas) applyCanvasNoise(thisArg.canvas);
            return Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 5. EVENT SYSTEM 
    // =========================================================
    const blockedEvents = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'blur', 'focusout', 'focusin', 'pagehide', 'pageshow',
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange',
        'pointerlockchange', 'mozpointerlockchange', 'webkitpointerlockchange'
    ]);

    proxyFunction(EventTarget.prototype, 'addEventListener', {
        apply(target, thisArg, args) {
            const type = args[0];
            let listener = args[1];
            
            if (typeof type === 'string' && blockedEvents.has(type.toLowerCase()) && listener) {
                let isObj = false;
                let callback = listener;
                if (typeof listener === 'object' && typeof listener.handleEvent === 'function') {
                    isObj = true;
                    callback = listener.handleEvent;
                }
                
                if (typeof callback === 'function') {
                    const wrapped = function(event) {
                        if (event && event.isTrusted) {
                            sendLog('blocked_event', type);
                            return; // Block real trusted events (user actually switched tabs)
                        }
                        // Allow synthetic events (isTrusted === false) to pass through to fool LMS
                        return Reflect.apply(callback, thisArg, arguments);
                    };
                    
                    if (isObj) {
                        args[1] = new Proxy(listener, {
                            get(t, p) { if (p === 'handleEvent') return wrapped; return Reflect.get(t, p); }
                        });
                    } else {
                        args[1] = wrapped;
                    }
                }
            }
            return Reflect.apply(target, thisArg, args);
        }
    });

    // Hook property setters for events like window.onblur
    blockedEvents.forEach(type => {
        const prop = 'on' + type;
        const hookOnProp = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, prop);
                if (desc && desc.set) {
                    const proxiedSet = new Proxy(desc.set, {
                        apply(target, thisArg, args) {
                            let listener = args[0];
                            if (typeof listener === 'function') {
                                const original = listener;
                                listener = function(event) {
                                    if (event && event.isTrusted) {
                                        sendLog('blocked_event', type);
                                        return;
                                    }
                                    return Reflect.apply(original, thisArg, arguments);
                                };
                            }
                            args[0] = listener;
                            return Reflect.apply(target, thisArg, args);
                        }
                    });
                    proxiedObjects.set(proxiedSet, desc.set);
                    Object.defineProperty(proto, prop, { ...desc, set: proxiedSet });
                }
            } catch(e) {}
        };
        hookOnProp(window.constructor ? window.constructor.prototype : Object.getPrototypeOf(window));
        hookOnProp(Document.prototype);
        hookOnProp(HTMLElement.prototype);
    });

    // =========================================================
    // 6. MUTATION OBSERVER
    // =========================================================
    proxyFunction(window, 'MutationObserver', {
        construct(target, args, newTarget) {
            const cb = args[0];
            const fakeCb = function (mutations, obs) {
                let filteredMutations = [];
                let bypassedCount = 0;

                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.type === 'childList') {
                        const normalNodes = Array.from(m.addedNodes).filter(node => !(node.dataset && node.dataset.bypass === 'true'));
                        if (normalNodes.length !== m.addedNodes.length) {
                            bypassedCount++;
                            if (normalNodes.length === 0 && m.removedNodes.length === 0) continue;
                            filteredMutations.push({
                                type: m.type, target: m.target, addedNodes: normalNodes, removedNodes: m.removedNodes,
                                previousSibling: m.previousSibling, nextSibling: m.nextSibling,
                                attributeName: m.attributeName, attributeNamespace: m.attributeNamespace, oldValue: m.oldValue
                            });
                            continue;
                        }
                    } else if (m.target && m.target.dataset && m.target.dataset.bypass === 'true') {
                        bypassedCount++;
                        continue;
                    }
                    filteredMutations.push(m);
                }
                if (bypassedCount > 0) sendLog('success', 'MutationObserver bypass applied');
                if (filteredMutations.length > 0) Reflect.apply(cb, this, [filteredMutations, obs]);
            };
            return Reflect.construct(target, [fakeCb], newTarget);
        }
    });

    // =========================================================
    // 7. IFRAME
    // =========================================================
    const processed = new WeakSet();
    function hardenWindow(win) {
        if (!win || processed.has(win)) return;
        processed.add(win);
        try {
            sendLog('info', 'Hardened iframe sandbox');

            // Override toString in iframe to use our perfect proxiedToString
            Object.defineProperty(win.Function.prototype, 'toString', {
                value: proxiedToString,
                writable: true,
                configurable: true,
                enumerable: false
            });
            proxyGetter(win.Document.prototype, 'hidden', () => false);
            proxyGetter(win.Document.prototype, 'visibilityState', () => 'visible');
            proxyFunction(win.Document.prototype, 'hasFocus', { apply() { return true; } });
            proxyGetter(win.Navigator.prototype, 'webdriver', () => undefined);

            // Proxy anti-debug in iframe
            proxyFunction(win, 'Function', {
                apply(target, thisArg, args) {
                    for (let i = 0; i < args.length; i++) trackAntiDebug(args[i]);
                    return Reflect.apply(target, thisArg, args);
                },
                construct(target, args, newTarget) {
                    for (let i = 0; i < args.length; i++) trackAntiDebug(args[i]);
                    return Reflect.construct(target, args, newTarget);
                }
            });
            proxyFunction(win, 'eval', {
                apply(target, thisArg, args) {
                    trackAntiDebug(args[0]);
                    return Reflect.apply(target, thisArg, args);
                }
            });
        } catch (e) { }
    }

    proxyGetter(HTMLIFrameElement.prototype, 'contentWindow', (target, thisArg, args) => {
        const win = Reflect.apply(target, thisArg, args);
        hardenWindow(win);
        return win;
    });
    proxyGetter(HTMLIFrameElement.prototype, 'contentDocument', (target, thisArg, args) => {
        const doc = Reflect.apply(target, thisArg, args);
        if (doc && doc.defaultView) hardenWindow(doc.defaultView);
        return doc;
    });

    document.querySelectorAll('iframe').forEach(iframe => {
        try { hardenWindow(iframe.contentWindow); } catch (e) { }
    });

    // =========================================================
    // 8. REQUEST FULLSCREEN
    // =========================================================
    ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach(name => {
        proxyFunction(Element.prototype, name, { apply() { return Promise.resolve(); } });
    });

    // =========================================================
    // 9. ANTI-DEBUGGER
    // =========================================================
    const trackAntiDebug = (str) => {
        if (typeof str === 'string' && str.includes('debugger')) {
            sendLog('error', 'Anti-debugger detected (debugger keyword in code execution)');
        }
    };

    proxyFunction(window, 'Function', {
        apply(target, thisArg, args) {
            for (let i = 0; i < args.length; i++) trackAntiDebug(args[i]);
            return Reflect.apply(target, thisArg, args);
        },
        construct(target, args, newTarget) {
            for (let i = 0; i < args.length; i++) trackAntiDebug(args[i]);
            return Reflect.construct(target, args, newTarget);
        }
    });
    
    // Secure [].constructor.constructor and (function(){}).constructor bypasses
    if (window.Function && Function.prototype) {
        Function.prototype.constructor = window.Function;
    }

    proxyFunction(window, 'eval', {
        apply(target, thisArg, args) {
            trackAntiDebug(args[0]);
            return Reflect.apply(target, thisArg, args);
        }
    });

    proxyFunction(window, 'setInterval', {
        apply(target, thisArg, args) {
            trackAntiDebug(args[0]);
            return Reflect.apply(target, thisArg, args);
        }
    });

    proxyFunction(window, 'setTimeout', {
        apply(target, thisArg, args) {
            trackAntiDebug(args[0]);
            return Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 10. WEB WORKER INJECTION
    // =========================================================
    const workerCore = `
        (function() {
            // Worker Anti-Detect Core
            try {
                if (navigator.webdriver !== undefined) {
                    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });
                }
                
                const proxyFn = (obj, prop, handlers) => {
                    try {
                        const orig = obj[prop];
                        if (typeof orig === 'function') obj[prop] = new Proxy(orig, handlers);
                    } catch(e) {}
                };

                const trackAntiDebug = (str) => {
                    if (typeof str === 'string' && str.includes('debugger')) {
                        // Silently drop or handle in worker
                    }
                };

                proxyFn(self, 'Function', {
                    apply(t, thisArg, args) {
                        for(let i=0; i<args.length; i++) trackAntiDebug(args[i]);
                        return Reflect.apply(t, thisArg, args);
                    },
                    construct(t, args, newT) {
                        for(let i=0; i<args.length; i++) trackAntiDebug(args[i]);
                        return Reflect.construct(t, args, newT);
                    }
                });

                proxyFn(self, 'eval', { apply(t, thisArg, args) { trackAntiDebug(args[0]); return Reflect.apply(t, thisArg, args); } });
                proxyFn(self, 'setInterval', { apply(t, thisArg, args) { trackAntiDebug(args[0]); return Reflect.apply(t, thisArg, args); } });
                proxyFn(self, 'setTimeout', { apply(t, thisArg, args) { trackAntiDebug(args[0]); return Reflect.apply(t, thisArg, args); } });
            } catch(e) {}
        })();
    `;

    proxyFunction(window, 'Worker', {
        construct(target, args, newTarget) {
            try {
                const scriptUrl = args[0];
                const options = args[1] || {};

                // Only process string URLs or Blobs
                if (typeof scriptUrl === 'string' || scriptUrl instanceof URL) {
                    const absoluteUrl = new URL(scriptUrl, location.href).href;
                    let payload;

                    if (options.type === 'module') {
                        payload = workerCore + '\\nawait import("' + absoluteUrl + '");';
                    } else {
                        payload = workerCore + '\\nimportScripts("' + absoluteUrl + '");';
                    }

                    const blob = new Blob([payload], { type: 'application/javascript' });
                    args[0] = URL.createObjectURL(blob);
                    sendLog('info', 'Injected anti-detect into Web Worker');
                }
            } catch (e) { }
            return Reflect.construct(target, args, newTarget);
        }
    });

})();