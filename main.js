// ==UserScript==
// @name         byfu (Stealth Shield)
// @namespace    http://tampermonkey.net/
// @version      8.5.0
// @description  Zero-Footprint Anti-Detection & LMS Shield
// @author       evilst
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 0. NATIVE FUNCTION CACHING (PROTECT AGAINST HOOKS)
    // =========================================================
    // We capture these immediately before the page can modify them (Prototype Pollution / DOM Clobbering defense)
    const N = {
        CustomEvent: window.CustomEvent,
        dispatchEvent: document.dispatchEvent,
        setTimeout: window.setTimeout,
        WeakMap: window.WeakMap,
        WeakSet: window.WeakSet,
        Set: window.Set,
        Promise: window.Promise,
        Blob: window.Blob,
        URL: window.URL,
        createObjectURL: window.URL ? window.URL.createObjectURL : null,
        Math: { max: Math.max },
        Reflect: {
            apply: Reflect.apply,
            construct: Reflect.construct,
            get: Reflect.get
        },
        Object: {
            defineProperty: Object.defineProperty,
            getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
            getPrototypeOf: Object.getPrototypeOf
        },
        String: {
            includes: String.prototype.includes,
            replace: String.prototype.replace,
            split: String.prototype.split,
            toLowerCase: String.prototype.toLowerCase
        },
        Array: {
            filter: Array.prototype.filter,
            join: Array.prototype.join,
            map: Array.prototype.map,
            forEach: Array.prototype.forEach,
            from: Array.from
        },
        Document: {
            querySelectorAll: Document.prototype.querySelectorAll
        }
    };

    // Safe wrappers to prevent prototype hijacking
    const strIncludes = (str, search) => N.Reflect.apply(N.String.includes, str, [search]);
    const strReplace = (str, search, rep) => N.Reflect.apply(N.String.replace, str, [search, rep]);
    const strSplit = (str, sep) => N.Reflect.apply(N.String.split, str, [sep]);
    const strToLower = (str) => N.Reflect.apply(N.String.toLowerCase, str, []);
    const arrFilter = (arr, fn) => N.Reflect.apply(N.Array.filter, arr, [fn]);
    const arrJoin = (arr, sep) => N.Reflect.apply(N.Array.join, arr, [sep]);
    const arrMap = (arr, fn) => N.Reflect.apply(N.Array.map, arr, [fn]);
    const arrForEach = (arr, fn) => N.Reflect.apply(N.Array.forEach, arr, [fn]);

    const INTERNAL_BRIDGE = "__byfu_evt_bridge__";
    let filtersTriggered = false;

    const sendLog = (type, detail) => {
        if (type === 'blocked_event' || type === 'mutation_filtered' || type === 'success') {
            filtersTriggered = true;
        }
        try {
            const evt = new N.CustomEvent(INTERNAL_BRIDGE, {
                detail: { type: type, detail: detail },
                bubbles: false,
                cancelable: false
            });
            N.Reflect.apply(N.dispatchEvent, document, [evt]);
        } catch (e) { }
    };

    sendLog('usage_start', location.href);
    window.addEventListener('load', () => {
        N.setTimeout(() => {
            if (!filtersTriggered) sendLog('info', 'Protection active, no fingerprinting detected.');
        }, 4000);
    });

    function scrubStack(e) {
        if (e && e.stack && typeof e.stack === 'string') {
            const lines = strSplit(e.stack, '\n');
            const filtered = arrFilter(lines, line => !strIncludes(line, 'chrome-extension://') && !strIncludes(line, 'moz-extension://'));
            e.stack = arrJoin(filtered, '\n');
        }
        return e;
    }

    const proxiedObjects = new N.WeakMap();
    const originalToString = Function.prototype.toString;

    // =========================================================
    // 0. PERFECT TOSTRING SPOOFING
    // =========================================================
    const proxiedToString = new Proxy(originalToString, {
        apply(target, thisArg, args) {
            if (typeof thisArg === 'function') {
                if (proxiedObjects.has(thisArg)) {
                    return N.Reflect.apply(target, proxiedObjects.get(thisArg), args);
                }
                if (thisArg === proxiedToString) {
                    return N.Reflect.apply(target, target, args);
                }
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    N.Object.defineProperty(Function.prototype, 'toString', {
        value: proxiedToString,
        writable: true,
        configurable: true,
        enumerable: false
    });

    function proxyGetter(proto, prop, fakeGetter) {
        try {
            if (!proto) return;
            const desc = N.Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.get) return;
            const originalGet = desc.get;

            const proxiedGet = new Proxy(originalGet, {
                apply(target, thisArg, args) {
                    try {
                        N.Reflect.apply(target, thisArg, args);
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

            proxiedObjects.set(proxiedGet, originalGet);
            N.Object.defineProperty(proto, prop, {
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
            proxiedObjects.set(p, original);
            obj[prop] = p;
        } catch (e) { }
    }

    // =========================================================
    // 1. VISIBILITY / FOCUS
    // =========================================================
    proxyGetter(Document.prototype, 'hidden', () => false);
    proxyGetter(Document.prototype, 'visibilityState', () => 'visible');
    ['webkitHidden', 'mozHidden', 'msHidden'].forEach(prop => {
        proxyGetter(Document.prototype, prop, () => false);
    });
    ['webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'].forEach(prop => {
        proxyGetter(Document.prototype, prop, () => 'visible');
    });
    proxyFunction(Document.prototype, 'hasFocus', { apply() { return true; } });

    // =========================================================
    // 2. FULLSCREEN – PROTOTYPE LEVEL
    // =========================================================
    ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach(p => {
        proxyGetter(Document.prototype, p, (target, thisArg) => thisArg.documentElement || thisArg.body);
    });
    ['fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled'].forEach(p => {
        proxyGetter(Document.prototype, p, () => true);
    });
    ['webkitIsFullScreen', 'mozFullScreen'].forEach(p => {
        proxyGetter(Document.prototype, p, () => true);
    });

    ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach(name => {
        proxyFunction(Element.prototype, name, { apply() { return N.Promise.resolve(); } });
    });
    ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach(name => {
        proxyFunction(Document.prototype, name, { apply() { return N.Promise.resolve(); } });
    });

    // =========================================================
    // 3. HARDWARE & WEBDRIVER FINGERPRINT SPOOFING
    // =========================================================
    proxyGetter(Navigator.prototype, 'webdriver', () => false);
    proxyGetter(Navigator.prototype, 'hardwareConcurrency', () => 8); // Standardize core count
    proxyGetter(Navigator.prototype, 'deviceMemory', () => 8); // Standardize RAM

    const spoofWebGLParameter = {
        apply(target, thisArg, args) {
            const param = args[0];
            if (param === 37445) return 'Google Inc. (Apple)';
            if (param === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
            return N.Reflect.apply(target, thisArg, args);
        }
    };

    if (window.WebGLRenderingContext) {
        proxyFunction(WebGLRenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }
    if (window.WebGL2RenderingContext) {
        proxyFunction(WebGL2RenderingContext.prototype, 'getParameter', spoofWebGLParameter);
    }

    // =========================================================
    // 4. CANVAS FINGERPRINT PROTECTION (WEAKSET-BASED)
    // =========================================================
    const taintedCanvases = new N.WeakSet();

    function applyCanvasNoise(canvas) {
        if (!canvas || canvas.width <= 16 || canvas.height <= 16 || taintedCanvases.has(canvas)) return;
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                taintedCanvases.add(canvas);
                const x = (canvas.width * 7) % N.Math.max(1, canvas.width - 1);
                const y = (canvas.height * 13) % N.Math.max(1, canvas.height - 1);
                ctx.fillStyle = 'rgba(0,0,0,0.004)';
                ctx.fillRect(x, y, 1, 1);
                sendLog('success', 'Canvas fingerprint protected');
            }
        } catch (e) { }
    }

    ['toDataURL', 'toBlob'].forEach(method => {
        proxyFunction(HTMLCanvasElement.prototype, method, {
            apply(target, thisArg, args) {
                applyCanvasNoise(thisArg);
                return N.Reflect.apply(target, thisArg, args);
            }
        });
    });

    proxyFunction(CanvasRenderingContext2D.prototype, 'getImageData', {
        apply(target, thisArg, args) {
            if (thisArg && thisArg.canvas) applyCanvasNoise(thisArg.canvas);
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 5. EVENT SYSTEM & LMS BYPASS
    // =========================================================
    const blockedEvents = new N.Set([
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'blur', 'focusout', 'pagehide', 'pageshow',
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'msfullscreenchange',
        'pointerlockchange', 'mozpointerlockchange', 'webkitpointerlockchange'
    ]);

    const listenerWrapperMap = new N.WeakMap();

    proxyFunction(EventTarget.prototype, 'addEventListener', {
        apply(target, thisArg, args) {
            const type = args[0];
            const listener = args[1];

            if (typeof type === 'string' && blockedEvents.has(strToLower(type)) && listener) {
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
                            return N.Reflect.apply(callback, thisArg, arguments);
                        };

                        if (isObj) {
                            const originalObj = listener;
                            wrapped = new Proxy(originalObj, {
                                get(t, p) {
                                    if (p === 'handleEvent') return wrapped;
                                    return N.Reflect.get(t, p);
                                }
                            });
                            proxiedObjects.set(wrapped, originalObj);
                        } else {
                            proxiedObjects.set(wrapped, callback);
                        }

                        listenerWrapperMap.set(listener, wrapped);
                    }
                    args[1] = wrapped;
                }
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    proxyFunction(EventTarget.prototype, 'removeEventListener', {
        apply(target, thisArg, args) {
            const type = args[0];
            const listener = args[1];

            if (typeof type === 'string' && blockedEvents.has(strToLower(type)) && listener) {
                const wrapped = listenerWrapperMap.get(listener);
                if (wrapped) {
                    args[1] = wrapped;
                }
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    const onPropMap = new N.WeakMap();
    arrForEach(N.Array.from(blockedEvents), type => {
        const prop = 'on' + type;
        const hookOnProp = (proto) => {
            try {
                if (!proto) return;
                const desc = N.Object.getOwnPropertyDescriptor(proto, prop);
                if (!desc || !desc.set) return;

                const origGet = desc.get;
                const origSet = desc.set;

                const proxiedGet = new Proxy(origGet, {
                    apply(target, thisArg, args) {
                        const map = onPropMap.get(thisArg);
                        if (map && prop in map) {
                            return map[prop];
                        }
                        return N.Reflect.apply(target, thisArg, args);
                    }
                });

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
                                return N.Reflect.apply(rawListener, thisArg, arguments);
                            };
                            proxiedObjects.set(wrapped, rawListener);
                            args[0] = wrapped;
                        }

                        return N.Reflect.apply(target, thisArg, args);
                    }
                });

                proxiedObjects.set(proxiedGet, origGet);
                proxiedObjects.set(proxiedSet, origSet);

                N.Object.defineProperty(proto, prop, {
                    ...desc,
                    get: proxiedGet,
                    set: proxiedSet
                });
            } catch (e) { }
        };

        const winProto = window.constructor ? window.constructor.prototype : N.Object.getPrototypeOf(window);
        hookOnProp(winProto);
        hookOnProp(Document.prototype);
        hookOnProp(HTMLElement.prototype);
    });

    const lmsProtectedEvents = new N.Set(['copy', 'paste', 'cut', 'contextmenu', 'selectstart', 'dragstart']);
    proxyFunction(Event.prototype, 'preventDefault', {
        apply(target, thisArg, args) {
            if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(strToLower(thisArg.type))) {
                if (thisArg.isTrusted) {
                    sendLog('success', `Bypassed LMS restriction on ${thisArg.type}`);
                    return; 
                }
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 6. ANTI-DEBUGGER NEUTRALIZATION
    // =========================================================
    function sanitizeCode(code) {
        if (typeof code !== 'string') return code;
        if (strIncludes(code, 'debugger')) {
            sendLog('error', 'Anti-debugger statement neutralized');
            return strReplace(code, /\bdebugger\b\s*;?/g, '/*noop*/;');
        }
        return code;
    }

    proxyFunction(window, 'Function', {
        apply(target, thisArg, args) {
            if (args.length > 0) {
                args = arrMap(N.Array.from(args), arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
            }
            return N.Reflect.apply(target, thisArg, args);
        },
        construct(target, args, newTarget) {
            if (args.length > 0) {
                args = arrMap(N.Array.from(args), arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
            }
            return N.Reflect.construct(target, args, newTarget);
        }
    });

    if (window.Function && Function.prototype) {
        Function.prototype.constructor = window.Function;
    }

    proxyFunction(window, 'eval', {
        apply(target, thisArg, args) {
            if (typeof args[0] === 'string') {
                args[0] = sanitizeCode(args[0]);
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    proxyFunction(window, 'setInterval', {
        apply(target, thisArg, args) {
            if (typeof args[0] === 'string') {
                args[0] = sanitizeCode(args[0]);
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    proxyFunction(window, 'setTimeout', {
        apply(target, thisArg, args) {
            if (typeof args[0] === 'string') {
                args[0] = sanitizeCode(args[0]);
            }
            return N.Reflect.apply(target, thisArg, args);
        }
    });

    // =========================================================
    // 7. IFRAME PROTECTION
    // =========================================================
    const processedWindows = new N.WeakSet();

    function hardenWindow(win) {
        if (!win || processedWindows.has(win)) return;
        processedWindows.add(win);
        try {
            if (win.Function && win.Function.prototype) {
                N.Object.defineProperty(win.Function.prototype, 'toString', {
                    value: proxiedToString,
                    writable: true,
                    configurable: true,
                    enumerable: false
                });
            }
            if (win.Document && win.Document.prototype) {
                proxyGetter(win.Document.prototype, 'hidden', () => false);
                proxyGetter(win.Document.prototype, 'visibilityState', () => 'visible');
                proxyFunction(win.Document.prototype, 'hasFocus', { apply() { return true; } });
            }
            if (win.Navigator && win.Navigator.prototype) {
                proxyGetter(win.Navigator.prototype, 'webdriver', () => false);
                proxyGetter(win.Navigator.prototype, 'hardwareConcurrency', () => 8);
                proxyGetter(win.Navigator.prototype, 'deviceMemory', () => 8);
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
                        if (thisArg && typeof thisArg.type === 'string' && lmsProtectedEvents.has(strToLower(thisArg.type)) && thisArg.isTrusted) {
                            return;
                        }
                        return N.Reflect.apply(target, thisArg, args);
                    }
                });
            }
            if (win.Function) {
                proxyFunction(win, 'Function', {
                    apply(target, thisArg, args) {
                        if (args.length > 0) {
                            args = arrMap(N.Array.from(args), arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
                        }
                        return N.Reflect.apply(target, thisArg, args);
                    },
                    construct(target, args, newTarget) {
                        if (args.length > 0) {
                            args = arrMap(N.Array.from(args), arg => typeof arg === 'string' ? sanitizeCode(arg) : arg);
                        }
                        return N.Reflect.construct(target, args, newTarget);
                    }
                });
            }
            if (win.eval) {
                proxyFunction(win, 'eval', {
                    apply(target, thisArg, args) {
                        if (typeof args[0] === 'string') args[0] = sanitizeCode(args[0]);
                        return N.Reflect.apply(target, thisArg, args);
                    }
                });
            }
        } catch (e) { }
    }

    proxyGetter(HTMLIFrameElement.prototype, 'contentWindow', (target, thisArg, args) => {
        const win = N.Reflect.apply(target, thisArg, args);
        if (win) hardenWindow(win);
        return win;
    });

    proxyGetter(HTMLIFrameElement.prototype, 'contentDocument', (target, thisArg, args) => {
        const doc = N.Reflect.apply(target, thisArg, args);
        if (doc && doc.defaultView) hardenWindow(doc.defaultView);
        return doc;
    });

    const iframes = N.Reflect.apply(N.Document.querySelectorAll, document, ['iframe']);
    arrForEach(N.Array.from(iframes), iframe => {
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

                proxyFn(self, 'Function', {
                    apply(t, thisArg, args) {
                        if (args.length > 0) args = Array.from(args).map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
                        return Reflect.apply(t, thisArg, args);
                    },
                    construct(t, args, newT) {
                        if (args.length > 0) args = Array.from(args).map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
                        return Reflect.construct(t, args, newT);
                    }
                });

                proxyFn(self, 'eval', {
                    apply(t, thisArg, args) {
                        if (typeof args[0] === 'string') args[0] = sanitize(args[0]);
                        return Reflect.apply(t, thisArg, args);
                    }
                });
                proxyFn(self, 'setInterval', {
                    apply(t, thisArg, args) {
                        if (typeof args[0] === 'string') args[0] = sanitize(args[0]);
                        return Reflect.apply(t, thisArg, args);
                    }
                });
                proxyFn(self, 'setTimeout', {
                    apply(t, thisArg, args) {
                        if (typeof args[0] === 'string') args[0] = sanitize(args[0]);
                        return Reflect.apply(t, thisArg, args);
                    }
                });
            } catch(e) {}
        })();
    `;

    proxyFunction(window, 'Worker', {
        construct(target, args, newTarget) {
            try {
                const scriptUrl = args[0];
                const options = args[1] || {};

                if (typeof scriptUrl === 'string' || scriptUrl instanceof N.URL) {
                    const absoluteUrl = new N.URL(scriptUrl, location.href).href;
                    let payload;

                    if (options.type === 'module') {
                        payload = workerCore + '\nawait import("' + absoluteUrl + '");';
                    } else {
                        payload = workerCore + '\nimportScripts("' + absoluteUrl + '");';
                    }

                    const blob = new N.Blob([payload], { type: 'application/javascript' });
                    const blobUrl = N.createObjectURL(blob);
                    const originalUrl = args[0];
                    args[0] = blobUrl;
                    try {
                        const worker = N.Reflect.construct(target, args, newTarget);
                        sendLog('info', 'Worker anti-detection active');
                        return worker;
                    } catch (cspErr) {
                        args[0] = originalUrl;
                    }
                }
            } catch (e) { }
            return N.Reflect.construct(target, args, newTarget);
        }
    });

})();