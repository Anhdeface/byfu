// ==UserScript==
// @name         byfu (Stealth Shield)
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  Zero-Footprint Anti-Detection & LMS Shield
// @author       evilst
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 0. COMMUNICATION PORT (INVISIBLE TO DOM)
    // =========================================================
    // Camouflage initialization message to mimic React DevTools
    const INIT_MSG = "__react_devtools_init__";
    const commChannel = new MessageChannel();
    let filtersTriggered = false;

    const sendLog = (type, detail) => {
        if (type === 'blocked_event' || type === 'mutation_filtered' || type === 'success') {
            filtersTriggered = true;
        }
        try {
            commChannel.port1.postMessage({ type, detail });
        } catch (e) { }
    };
    
    window.postMessage(INIT_MSG, "*", [commChannel.port2]);
    sendLog('usage_start', location.href);
    
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (!filtersTriggered) sendLog('info', 'Protection active, no fingerprinting detected.');
        }, 4000);
    });

    // =========================================================
    // 1. STACK TRACE STEALTH & PROTOTYPE DEFENSE
    // =========================================================
    const $apply = Reflect.apply;
    const $split = String.prototype.split;
    const $filter = Array.prototype.filter;
    const $includes = String.prototype.includes;
    const $join = Array.prototype.join;

    function scrubStack(e) {
        if (e && e.stack && typeof e.stack === 'string') {
            const lines = $apply($split, e.stack, ['\n']);
            const clean = $apply($filter, lines, [line => !$apply($includes, line, ['chrome-extension://']) && !$apply($includes, line, ['moz-extension://'])]);
            e.stack = $apply($join, clean, ['\n']);
        }
        return e;
    }

    // =========================================================
    // 2. UNIVERSAL TOSTRING SPOOFER (WEAKSET-BASED)
    // =========================================================
    const hF = new WeakSet();
    const originalToString = Function.prototype.toString;

    const proxiedToString = new Proxy(originalToString, {
        apply(target, thisArg, args) {
            try {
                if (hF.has(thisArg)) {
                    const name = thisArg.name ? thisArg.name.replace(/^(get|set)\s/, '') : '';
                    return `function ${name}() { [native code] }`;
                }
                return $apply(target, thisArg, args);
            } catch (e) {
                return $apply(target, thisArg, args); 
            }
        }
    });
    hF.add(proxiedToString);

    Object.defineProperty(Function.prototype, 'toString', {
        value: proxiedToString,
        writable: true,
        configurable: true,
        enumerable: false
    });

    // Advanced Defense: Defeat V8 Raw CallSite sniffing WITHOUT breaking page logic (e.g. Sentry)
    let pagePrepareStackTrace = undefined;
    Object.defineProperty(Error, 'prepareStackTrace', {
        configurable: true,
        enumerable: false,
        get() {
            return pagePrepareStackTrace; // Return the hooked version or undefined
        },
        set(val) {
            if (typeof val === 'function') {
                pagePrepareStackTrace = function(err, traces) {
                    const filtered = [];
                    for (let i = 0; i < traces.length; i++) {
                        const name = traces[i].getFileName();
                        if (name && (name.includes('chrome-extension://') || name.includes('moz-extension://'))) {
                            continue;
                        }
                        filtered.push(traces[i]);
                    }
                    return val(err, filtered); // Pass clean traces to the page's tool (like Sentry)
                };
                hF.add(pagePrepareStackTrace);
            } else {
                pagePrepareStackTrace = val;
            }
        }
    });

    function proxyGetter(proto, prop, fakeGetter) {
        try {
            if (!proto) return;
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.get) return;
            const originalGet = desc.get;

            const proxiedGet = new Proxy(originalGet, {
                apply(target, thisArg, args) {
                    try {
                        $apply(target, thisArg, args);
                    } catch (err) {
                        throw scrubStack(err);
                    }
                    try {
                        return fakeGetter(target, thisArg, args);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                }
            });
            hF.add(proxiedGet);

            Object.defineProperty(proto, prop, {
                ...desc,
                get: proxiedGet
            });
        } catch (e) { }
    }

    function proxyFunction(obj, prop, handlers) {
        try {
            if (!obj) return;
            const original = obj[prop];
            if (typeof original !== 'function') return;

            const safeHandlers = {};
            if (handlers.apply) {
                safeHandlers.apply = function (target, thisArg, args) {
                    try {
                        return handlers.apply(target, thisArg, args);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                };
            }
            if (handlers.construct) {
                safeHandlers.construct = function (target, args, newTarget) {
                    try {
                        return handlers.construct(target, args, newTarget);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                };
            }

            const p = new Proxy(original, safeHandlers);
            hF.add(p);
            obj[prop] = p;
        } catch (e) { }
    }

    // =========================================================
    // 3. VISIBILITY / FOCUS
    // =========================================================
    const falseGetter = () => false;
    const trueGetter = () => true;
    const visibleGetter = () => 'visible';

    proxyGetter(Document.prototype, 'hidden', falseGetter);
    proxyGetter(Document.prototype, 'visibilityState', visibleGetter);
    ['webkitHidden', 'mozHidden', 'msHidden'].forEach(prop => proxyGetter(Document.prototype, prop, falseGetter));
    ['webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'].forEach(prop => proxyGetter(Document.prototype, prop, visibleGetter));
    proxyFunction(Document.prototype, 'hasFocus', { apply: trueGetter });

    // =========================================================
    // 4. FULLSCREEN – PROTOTYPE LEVEL
    // =========================================================
    const fsElementGetter = (target, thisArg) => thisArg.documentElement || thisArg.body;
    ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach(p => proxyGetter(Document.prototype, p, fsElementGetter));
    ['fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled'].forEach(p => proxyGetter(Document.prototype, p, trueGetter));
    ['webkitIsFullScreen', 'mozFullScreen'].forEach(p => proxyGetter(Document.prototype, p, trueGetter));

    const promiseResolver = () => Promise.resolve();
    ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach(name => {
        proxyFunction(Element.prototype, name, { apply: promiseResolver });
    });
    ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach(name => {
        proxyFunction(Document.prototype, name, { apply: promiseResolver });
    });

    // =========================================================
    // 5. HARDWARE & WEBDRIVER FINGERPRINT SPOOFING
    // =========================================================
    proxyGetter(Navigator.prototype, 'webdriver', falseGetter);
    const eightGetter = () => 8;
    proxyGetter(Navigator.prototype, 'hardwareConcurrency', eightGetter); 
    proxyGetter(Navigator.prototype, 'deviceMemory', eightGetter); 

    const spoofWebGLParameter = {
        apply(target, thisArg, args) {
            const param = args[0];
            if (param === 37445) return 'Google Inc. (Apple)';
            if (param === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
            return $apply(target, thisArg, args);
        }
    };

    if (window.WebGLRenderingContext) {
        proxyFunction(WebGLRenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }
    if (window.WebGL2RenderingContext) {
        proxyFunction(WebGL2RenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }

    // =========================================================
    // 6. CANVAS FINGERPRINT PROTECTION (NON-DETERMINISTIC)
    // =========================================================
    const taintedCanvases = new WeakSet();

    function applyCanvasNoise(canvas) {
        if (!canvas || canvas.width <= 16 || canvas.height <= 16 || taintedCanvases.has(canvas)) return;
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                taintedCanvases.add(canvas);
                
                // Randomize coordinates and colors per canvas instance to prevent algorithmic fingerprinting
                const rX = Math.floor(Math.random() * (canvas.width - 1));
                const rY = Math.floor(Math.random() * (canvas.height - 1));
                const r = Math.floor(Math.random() * 20);
                const g = Math.floor(Math.random() * 20);
                const b = Math.floor(Math.random() * 20);
                const a = (Math.random() * 0.003 + 0.001).toFixed(4);
                
                ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                ctx.fillRect(rX, rY, 1, 1);
                sendLog('success', 'Canvas fingerprint dynamically protected');
            }
        } catch (e) { }
    }

    ['toDataURL', 'toBlob'].forEach(method => {
        proxyFunction(HTMLCanvasElement.prototype, method, {
            apply(target, thisArg, args) {
                applyCanvasNoise(thisArg);
                return $apply(target, thisArg, args);
            }
        });
    });

    proxyFunction(CanvasRenderingContext2D.prototype, 'getImageData', {
        apply(target, thisArg, args) {
            if (thisArg && thisArg.canvas) applyCanvasNoise(thisArg.canvas);
            return $apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 7. EVENT SYSTEM & LMS BYPASS
    // =========================================================
    const blockedEvents = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'blur', 'focusout', 'pagehide', 'pageshow',
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'msfullscreenchange',
        'pointerlockchange', 'mozpointerlockchange', 'webkitpointerlockchange'
    ]);

    const listenerWrapperMap = new WeakMap();

    const addEventListenerHandler = {
        apply(target, thisArg, args) {
            const type = args[0];
            const listener = args[1];

            if (typeof type === 'string' && blockedEvents.has(type.toLowerCase()) && listener) {
                let callback = listener;
                let isObj = false;

                if (typeof listener === 'object' && listener !== null && typeof listener.handleEvent === 'function') {
                    isObj = true;
                    callback = listener.handleEvent;
                }

                if (typeof callback === 'function') {
                    let wrapped = listenerWrapperMap.get(listener);
                    if (!wrapped) {
                        wrapped = function (event) {
                            if (event && event.isTrusted) {
                                sendLog('blocked_event', type);
                                return; 
                            }
                            return $apply(callback, thisArg, arguments);
                        };

                        if (isObj) {
                            wrapped = new Proxy(listener, {
                                get(t, p) {
                                    if (p === 'handleEvent') return wrapped;
                                    return Reflect.get(t, p);
                                }
                            });
                        }
                        listenerWrapperMap.set(listener, wrapped);
                    }
                    args[1] = wrapped;
                }
            }
            return $apply(target, thisArg, args);
        }
    };

    proxyFunction(EventTarget.prototype, 'addEventListener', addEventListenerHandler);

    proxyFunction(EventTarget.prototype, 'removeEventListener', {
        apply(target, thisArg, args) {
            const type = args[0];
            const listener = args[1];

            if (typeof type === 'string' && blockedEvents.has(type.toLowerCase()) && listener) {
                const wrapped = listenerWrapperMap.get(listener);
                if (wrapped) {
                    args[1] = wrapped;
                }
            }
            return $apply(target, thisArg, args);
        }
    });

    const onPropMap = new WeakMap();
    blockedEvents.forEach(type => {
        const prop = 'on' + type;
        const hookOnProp = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, prop);
                if (!desc || !desc.set) return;

                const origGet = desc.get;
                const origSet = desc.set;

                const proxiedGet = new Proxy(origGet, {
                    apply(target, thisArg, args) {
                        const map = onPropMap.get(thisArg);
                        if (map && prop in map) return map[prop];
                        return $apply(target, thisArg, args);
                    }
                });
                hF.add(proxiedGet);

                const proxiedSet = new Proxy(origSet, {
                    apply(target, thisArg, args) {
                        const rawListener = args[0];
                        let map = onPropMap.get(thisArg);
                        if (!map) {
                            map = {};
                            onPropMap.set(thisArg, map);
                        }
                        map[prop] = rawListener;

                        if (typeof rawListener === 'function') {
                            const wrapped = function (event) {
                                if (event && event.isTrusted) {
                                    sendLog('blocked_event', type);
                                    return;
                                }
                                return $apply(rawListener, thisArg, arguments);
                            };
                            args[0] = wrapped;
                        }

                        return $apply(target, thisArg, args);
                    }
                });
                hF.add(proxiedSet);

                Object.defineProperty(proto, prop, {
                    ...desc,
                    get: proxiedGet,
                    set: proxiedSet
                });
            } catch (e) { }
        };

        const winProto = window.constructor ? window.constructor.prototype : Object.getPrototypeOf(window);
        hookOnProp(winProto);
        hookOnProp(Document.prototype);
        hookOnProp(HTMLElement.prototype);
    });

    const lmsProtectedEvents = new Set(['copy', 'paste', 'cut', 'contextmenu', 'selectstart', 'dragstart']);
    proxyFunction(Event.prototype, 'preventDefault', {
        apply(target, thisArg, args) {
            if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(thisArg.type.toLowerCase())) {
                if (thisArg.isTrusted) {
                    sendLog('success', `Bypassed LMS restriction on ${thisArg.type}`);
                    return; 
                }
            }
            return $apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 8. ANTI-DEBUGGER NEUTRALIZATION
    // =========================================================
    function sanitizeCode(code) {
        if (typeof code !== 'string') return code;
        if (code.includes('debugger')) {
            sendLog('error', 'Anti-debugger statement neutralized');
            return code.replace(/\\bdebugger\\b\\s*;?/g, '/*noop*/;');
        }
        return code;
    }

    const codeSanitizerApply = (target, thisArg, args) => {
        if (args.length > 0) {
            args = Array.from(args).map(arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
        }
        return $apply(target, thisArg, args);
    };
    
    const codeSanitizerConstruct = (target, args, newTarget) => {
        if (args.length > 0) {
            args = Array.from(args).map(arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
        }
        return Reflect.construct(target, args, newTarget);
    };

    proxyFunction(window, 'Function', {
        apply: codeSanitizerApply,
        construct: codeSanitizerConstruct
    });

    if (window.Function && Function.prototype) {
        Function.prototype.constructor = window.Function;
    }

    proxyFunction(window, 'eval', { apply: codeSanitizerApply });
    proxyFunction(window, 'setInterval', { apply: codeSanitizerApply });
    proxyFunction(window, 'setTimeout', { apply: codeSanitizerApply });

    // =========================================================
    // 9. IFRAME PROTECTION
    // =========================================================
    const processedWindows = new WeakSet();

    function hardenWindow(win) {
        if (!win || processedWindows.has(win)) return;
        processedWindows.add(win);
        try {
            if (win.Function && win.Function.prototype) {
                Object.defineProperty(win.Function.prototype, 'toString', {
                    value: proxiedToString,
                    writable: true,
                    configurable: true,
                    enumerable: false
                });
            }
            if (win.Document && win.Document.prototype) {
                proxyGetter(win.Document.prototype, 'hidden', falseGetter);
                proxyGetter(win.Document.prototype, 'visibilityState', visibleGetter);
                proxyFunction(win.Document.prototype, 'hasFocus', { apply: trueGetter });
            }
            if (win.Navigator && win.Navigator.prototype) {
                proxyGetter(win.Navigator.prototype, 'webdriver', falseGetter);
                proxyGetter(win.Navigator.prototype, 'hardwareConcurrency', eightGetter);
                proxyGetter(win.Navigator.prototype, 'deviceMemory', eightGetter);
            }
            if (win.WebGLRenderingContext) {
                proxyFunction(win.WebGLRenderingContext.prototype, 'getParameter', spoofWebGLParameter);
            }
            if (win.WebGL2RenderingContext) {
                proxyFunction(win.WebGL2RenderingContext.prototype, 'getParameter', spoofWebGLParameter);
            }
            if (win.Event && win.Event.prototype) {
                proxyFunction(win.Event.prototype, 'preventDefault', {
                    apply(target, thisArg, args) {
                        if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(thisArg.type.toLowerCase()) && thisArg.isTrusted) {
                            return;
                        }
                        return $apply(target, thisArg, args);
                    }
                });
            }
            if (win.Function) {
                proxyFunction(win, 'Function', { apply: codeSanitizerApply, construct: codeSanitizerConstruct });
            }
            if (win.eval) {
                proxyFunction(win, 'eval', { apply: codeSanitizerApply });
            }
        } catch (e) { }
    }

    proxyGetter(HTMLIFrameElement.prototype, 'contentWindow', (target, thisArg, args) => {
        const win = $apply(target, thisArg, args);
        if (win) hardenWindow(win);
        return win;
    });

    proxyGetter(HTMLIFrameElement.prototype, 'contentDocument', (target, thisArg, args) => {
        const doc = $apply(target, thisArg, args);
        if (doc && doc.defaultView) hardenWindow(doc.defaultView);
        return doc;
    });

    document.querySelectorAll('iframe').forEach(iframe => {
        try {
            if (iframe.contentWindow) hardenWindow(iframe.contentWindow);
        } catch (e) { }
    });

    // =========================================================
    // 10. WEB WORKER INJECTION & CSP FALLBACK PROXY
    // =========================================================
    const workerCore = `
        (function() {
            try {
                if (self.Navigator && self.Navigator.prototype) {
                    const spoofProp = (prop, val) => {
                        const desc = Object.getOwnPropertyDescriptor(self.Navigator.prototype, prop);
                        if (desc && desc.get) {
                            Object.defineProperty(self.Navigator.prototype, prop, {
                                get: function() { return val; },
                                configurable: true,
                                enumerable: true
                            });
                        }
                    };
                    spoofProp('webdriver', false);
                    spoofProp('hardwareConcurrency', 8);
                    spoofProp('deviceMemory', 8);
                }
                
                const sanitize = function(code) {
                    if (typeof code === 'string' && code.includes('debugger')) {
                        return code.replace(/\\bdebugger\\b\\s*;?/g, '/*noop*/;');
                    }
                    return code;
                };

                const proxyFn = function(obj, prop, handlers) {
                    try {
                        const orig = obj[prop];
                        if (typeof orig === 'function') obj[prop] = new Proxy(orig, handlers);
                    } catch(e) {}
                };

                const cApply = (t, thisArg, args) => {
                    if (args.length > 0) args = Array.from(args).map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
                    return Reflect.apply(t, thisArg, args);
                };
                
                const cConstruct = (t, args, newT) => {
                    if (args.length > 0) args = Array.from(args).map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
                    return Reflect.construct(t, args, newT);
                };

                proxyFn(self, 'Function', { apply: cApply, construct: cConstruct });
                proxyFn(self, 'eval', { apply: cApply });
                proxyFn(self, 'setInterval', { apply: cApply });
                proxyFn(self, 'setTimeout', { apply: cApply });
            } catch(e) {}
        })();
    `;

    proxyFunction(window, 'Worker', {
        construct(target, args, newTarget) {
            try {
                const scriptUrl = args[0];
                const options = args[1] || {};

                if (typeof scriptUrl === 'string' || scriptUrl instanceof URL) {
                    const absoluteUrl = new URL(scriptUrl, location.href).href;
                    let payload = options.type === 'module' 
                        ? workerCore + '\nawait import("' + absoluteUrl + '");'
                        : workerCore + '\nimportScripts("' + absoluteUrl + '");';

                    const blob = new Blob([payload], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    
                    try {
                        args[0] = blobUrl;
                        const worker = Reflect.construct(target, args, newTarget);
                        sendLog('info', 'Worker anti-detection active');
                        return worker;
                    } catch (cspErr) {
                        try {
                            const dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(payload);
                            args[0] = dataUrl;
                            const worker2 = Reflect.construct(target, args, newTarget);
                            sendLog('info', 'Worker anti-detection active (Data URL)');
                            return worker2;
                        } catch (cspErr2) {
                            // Strict CSP fallback: Wrap the naked worker to sanitize outgoing telemetry
                            args[0] = absoluteUrl;
                            const nakedWorker = Reflect.construct(target, args, newTarget);
                            
                            const wrappedWorker = new Proxy(nakedWorker, {
                                get(t, p) {
                                    if (p === 'addEventListener') {
                                        return function(type, listener, opts) {
                                            if (type === 'message' && typeof listener === 'function') {
                                                const safeListener = function(e) {
                                                    if (e.data && typeof e.data === 'object') {
                                                        if (e.data.hardwareConcurrency) e.data.hardwareConcurrency = 8;
                                                        if (e.data.deviceMemory) e.data.deviceMemory = 8;
                                                    }
                                                    return $apply(listener, this, arguments);
                                                };
                                                hF.add(safeListener);
                                                return $apply(t.addEventListener, t, [type, safeListener, opts]);
                                            }
                                            return $apply(t.addEventListener, t, arguments);
                                        };
                                    }
                                    if (p === 'onmessage') return t.onmessage;
                                    return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
                                },
                                set(t, p, val) {
                                    if (p === 'onmessage' && typeof val === 'function') {
                                        const safeListener = function(e) {
                                            if (e.data && typeof e.data === 'object') {
                                                if (e.data.hardwareConcurrency) e.data.hardwareConcurrency = 8;
                                                if (e.data.deviceMemory) e.data.deviceMemory = 8;
                                            }
                                            return $apply(val, this, arguments);
                                        };
                                        hF.add(safeListener);
                                        t.onmessage = safeListener;
                                        return true;
                                    }
                                    t[p] = val;
                                    return true;
                                }
                            });
                            hF.add(wrappedWorker);
                            sendLog('warning', 'Strict CSP blocked payload. Worker telemetry proxied instead.');
                            return wrappedWorker;
                        }
                    }
                }
            } catch (e) { }
            return Reflect.construct(target, args, newTarget);
        }
    });

})();