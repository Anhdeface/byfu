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

    const INTERNAL_BRIDGE = "__byfu_evt_bridge__";
    let filtersTriggered = false;

    const sendLog = (type, detail) => {
        /*_byfu_*/
        if (type === 'blocked_event' || type === 'mutation_filtered' || type === 'success') {
            filtersTriggered = true;
        }
        try {
            const evt = new CustomEvent(INTERNAL_BRIDGE, {
                detail: { type: type, detail: detail },
                bubbles: false,
                cancelable: false
            });
            document.dispatchEvent(evt);
        } catch (e) { }
    };

    sendLog('usage_start', location.href);
    window.addEventListener('load', () => {
        /*_byfu_*/
        setTimeout(() => {
            /*_byfu_*/
            if (!filtersTriggered) sendLog('info', 'Protection active, no fingerprinting detected.');
        }, 4000);
    });

    function scrubStack(e) {
        /*_byfu_*/
        if (e && e.stack && typeof e.stack === 'string') {
            e.stack = e.stack.split('\n')
                .filter(line => !line.includes('chrome-extension://') && !line.includes('moz-extension://'))
                .join('\n');
        }
        return e;
    }

    // =========================================================
    // 0. UNIVERSAL TOSTRING SPOOFER (HIGHLY OPTIMIZED)
    // =========================================================
    // This totally eliminates the need for manual tracking via WeakMaps.
    // Any function containing the silent comment /*_byfu_*/ will automatically
    // be spoofed as a native function when websites try to inspect it.
    const originalToString = Function.prototype.toString;
    const proxiedToString = new Proxy(originalToString, {
        apply(target, thisArg, args) {
            try {
                const source = Reflect.apply(target, thisArg, args);
                if (source.includes('/*_byfu_*/')) {
                    const name = thisArg.name ? thisArg.name.replace(/^(get|set)\s/, '') : '';
                    return `function ${name}() { [native code] }`;
                }
                return source;
            } catch (e) {
                // Preserve native error throwing (e.g. calling toString on null/undefined)
                return Reflect.apply(target, thisArg, args); 
            }
        }
    });

    Object.defineProperty(Function.prototype, 'toString', {
        value: proxiedToString,
        writable: true,
        configurable: true,
        enumerable: false
    });

    // Helper to proxy getter safely
    function proxyGetter(proto, prop, fakeGetter) {
        /*_byfu_*/
        try {
            if (!proto) return;
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.get) return;
            const originalGet = desc.get;

            const proxiedGet = new Proxy(originalGet, {
                apply(target, thisArg, args) {
                    /*_byfu_*/
                    try {
                        Reflect.apply(target, thisArg, args);
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

            Object.defineProperty(proto, prop, {
                ...desc,
                get: proxiedGet
            });
        } catch (e) { }
    }

    // Helper to proxy function or constructor
    function proxyFunction(obj, prop, handlers) {
        /*_byfu_*/
        try {
            if (!obj) return;
            const original = obj[prop];
            if (typeof original !== 'function') return;

            const safeHandlers = {};
            if (handlers.apply) {
                safeHandlers.apply = function (target, thisArg, args) {
                    /*_byfu_*/
                    try {
                        return handlers.apply(target, thisArg, args);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                };
            }
            if (handlers.construct) {
                safeHandlers.construct = function (target, args, newTarget) {
                    /*_byfu_*/
                    try {
                        return handlers.construct(target, args, newTarget);
                    } catch (e) {
                        throw scrubStack(e);
                    }
                };
            }

            obj[prop] = new Proxy(original, safeHandlers);
        } catch (e) { }
    }

    // =========================================================
    // 1. VISIBILITY / FOCUS
    // =========================================================
    const falseGetter = () => { /*_byfu_*/ return false; };
    const trueGetter = () => { /*_byfu_*/ return true; };
    const visibleGetter = () => { /*_byfu_*/ return 'visible'; };

    proxyGetter(Document.prototype, 'hidden', falseGetter);
    proxyGetter(Document.prototype, 'visibilityState', visibleGetter);
    ['webkitHidden', 'mozHidden', 'msHidden'].forEach(prop => proxyGetter(Document.prototype, prop, falseGetter));
    ['webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'].forEach(prop => proxyGetter(Document.prototype, prop, visibleGetter));
    proxyFunction(Document.prototype, 'hasFocus', { apply: trueGetter });

    // =========================================================
    // 2. FULLSCREEN – PROTOTYPE LEVEL
    // =========================================================
    const fsElementGetter = (target, thisArg) => { /*_byfu_*/ return thisArg.documentElement || thisArg.body; };
    ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach(p => proxyGetter(Document.prototype, p, fsElementGetter));
    ['fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled'].forEach(p => proxyGetter(Document.prototype, p, trueGetter));
    ['webkitIsFullScreen', 'mozFullScreen'].forEach(p => proxyGetter(Document.prototype, p, trueGetter));

    const promiseResolver = () => { /*_byfu_*/ return Promise.resolve(); };
    ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach(name => {
        proxyFunction(Element.prototype, name, { apply: promiseResolver });
    });
    ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach(name => {
        proxyFunction(Document.prototype, name, { apply: promiseResolver });
    });

    // =========================================================
    // 3. HARDWARE & WEBDRIVER FINGERPRINT SPOOFING
    // =========================================================
    proxyGetter(Navigator.prototype, 'webdriver', falseGetter);
    const eightGetter = () => { /*_byfu_*/ return 8; };
    proxyGetter(Navigator.prototype, 'hardwareConcurrency', eightGetter); 
    proxyGetter(Navigator.prototype, 'deviceMemory', eightGetter); 

    const spoofWebGLParameter = {
        apply(target, thisArg, args) {
            /*_byfu_*/
            const param = args[0];
            if (param === 37445) return 'Google Inc. (Apple)';
            if (param === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
            return Reflect.apply(target, thisArg, args);
        }
    };

    if (window.WebGLRenderingContext) {
        proxyFunction(WebGLRenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }
    if (window.WebGL2RenderingContext) {
        proxyFunction(WebGL2RenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }

    // =========================================================
    // 4. CANVAS FINGERPRINT PROTECTION
    // =========================================================
    const taintedCanvases = new WeakSet();

    function applyCanvasNoise(canvas) {
        /*_byfu_*/
        if (!canvas || canvas.width <= 16 || canvas.height <= 16 || taintedCanvases.has(canvas)) return;
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                taintedCanvases.add(canvas);
                const x = (canvas.width * 7) % Math.max(1, canvas.width - 1);
                const y = (canvas.height * 13) % Math.max(1, canvas.height - 1);
                ctx.fillStyle = 'rgba(0,0,0,0.004)';
                ctx.fillRect(x, y, 1, 1);
                sendLog('success', 'Canvas fingerprint protected');
            }
        } catch (e) { }
    }

    ['toDataURL', 'toBlob'].forEach(method => {
        proxyFunction(HTMLCanvasElement.prototype, method, {
            apply(target, thisArg, args) {
                /*_byfu_*/
                applyCanvasNoise(thisArg);
                return Reflect.apply(target, thisArg, args);
            }
        });
    });

    proxyFunction(CanvasRenderingContext2D.prototype, 'getImageData', {
        apply(target, thisArg, args) {
            /*_byfu_*/
            if (thisArg && thisArg.canvas) applyCanvasNoise(thisArg.canvas);
            return Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 5. EVENT SYSTEM & LMS BYPASS
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
            /*_byfu_*/
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
                            /*_byfu_*/
                            if (event && event.isTrusted) {
                                sendLog('blocked_event', type);
                                return; 
                            }
                            return Reflect.apply(callback, thisArg, arguments);
                        };

                        if (isObj) {
                            wrapped = new Proxy(listener, {
                                get(t, p) {
                                    /*_byfu_*/
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
            return Reflect.apply(target, thisArg, args);
        }
    };

    proxyFunction(EventTarget.prototype, 'addEventListener', addEventListenerHandler);

    proxyFunction(EventTarget.prototype, 'removeEventListener', {
        apply(target, thisArg, args) {
            /*_byfu_*/
            const type = args[0];
            const listener = args[1];

            if (typeof type === 'string' && blockedEvents.has(type.toLowerCase()) && listener) {
                const wrapped = listenerWrapperMap.get(listener);
                if (wrapped) {
                    args[1] = wrapped;
                }
            }
            return Reflect.apply(target, thisArg, args);
        }
    });

    const onPropMap = new WeakMap();
    blockedEvents.forEach(type => {
        const prop = 'on' + type;
        const hookOnProp = (proto) => {
            /*_byfu_*/
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, prop);
                if (!desc || !desc.set) return;

                const origGet = desc.get;
                const origSet = desc.set;

                const proxiedGet = new Proxy(origGet, {
                    apply(target, thisArg, args) {
                        /*_byfu_*/
                        const map = onPropMap.get(thisArg);
                        if (map && prop in map) return map[prop];
                        return Reflect.apply(target, thisArg, args);
                    }
                });

                const proxiedSet = new Proxy(origSet, {
                    apply(target, thisArg, args) {
                        /*_byfu_*/
                        const rawListener = args[0];
                        let map = onPropMap.get(thisArg);
                        if (!map) {
                            map = {};
                            onPropMap.set(thisArg, map);
                        }
                        map[prop] = rawListener;

                        if (typeof rawListener === 'function') {
                            const wrapped = function (event) {
                                /*_byfu_*/
                                if (event && event.isTrusted) {
                                    sendLog('blocked_event', type);
                                    return;
                                }
                                return Reflect.apply(rawListener, thisArg, arguments);
                            };
                            args[0] = wrapped;
                        }

                        return Reflect.apply(target, thisArg, args);
                    }
                });

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
            /*_byfu_*/
            if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(thisArg.type.toLowerCase())) {
                if (thisArg.isTrusted) {
                    sendLog('success', `Bypassed LMS restriction on ${thisArg.type}`);
                    return; 
                }
            }
            return Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 6. ANTI-DEBUGGER NEUTRALIZATION
    // =========================================================
    function sanitizeCode(code) {
        /*_byfu_*/
        if (typeof code !== 'string') return code;
        if (code.includes('debugger')) {
            sendLog('error', 'Anti-debugger statement neutralized');
            return code.replace(/\bdebugger\b\s*;?/g, '/*noop*/;');
        }
        return code;
    }

    const codeSanitizerApply = (target, thisArg, args) => {
        /*_byfu_*/
        if (args.length > 0) {
            args = Array.from(args).map(arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
        }
        return Reflect.apply(target, thisArg, args);
    };
    
    const codeSanitizerConstruct = (target, args, newTarget) => {
        /*_byfu_*/
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
    // 7. IFRAME PROTECTION
    // =========================================================
    const processedWindows = new WeakSet();

    function hardenWindow(win) {
        /*_byfu_*/
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
                        /*_byfu_*/
                        if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(thisArg.type.toLowerCase()) && thisArg.isTrusted) {
                            return;
                        }
                        return Reflect.apply(target, thisArg, args);
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
        /*_byfu_*/
        const win = Reflect.apply(target, thisArg, args);
        if (win) hardenWindow(win);
        return win;
    });

    proxyGetter(HTMLIFrameElement.prototype, 'contentDocument', (target, thisArg, args) => {
        /*_byfu_*/
        const doc = Reflect.apply(target, thisArg, args);
        if (doc && doc.defaultView) hardenWindow(doc.defaultView);
        return doc;
    });

    document.querySelectorAll('iframe').forEach(iframe => {
        /*_byfu_*/
        try {
            if (iframe.contentWindow) hardenWindow(iframe.contentWindow);
        } catch (e) { }
    });

    // =========================================================
    // 8. WEB WORKER INJECTION
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
            /*_byfu_*/
            try {
                const scriptUrl = args[0];
                const options = args[1] || {};

                if (typeof scriptUrl === 'string' || scriptUrl instanceof URL) {
                    const absoluteUrl = new URL(scriptUrl, location.href).href;
                    let payload;

                    if (options.type === 'module') {
                        payload = workerCore + '\nawait import("' + absoluteUrl + '");';
                    } else {
                        payload = workerCore + '\nimportScripts("' + absoluteUrl + '");';
                    }

                    const blob = new Blob([payload], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    const originalUrl = args[0];
                    args[0] = blobUrl;
                    try {
                        const worker = Reflect.construct(target, args, newTarget);
                        sendLog('info', 'Worker anti-detection active');
                        return worker;
                    } catch (cspErr) {
                        args[0] = originalUrl;
                    }
                }
            } catch (e) { }
            return Reflect.construct(target, args, newTarget);
        }
    });

})();