(function () {
    'use strict';

    // =========================================================
    // 0. COMMUNICATION PORT (INVISIBLE TO DOM)
    // =========================================================
    // Dynamic token handshake without static prefixes or honeypot signatures
    const handshakeToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + Date.now().toString(36));
    const commChannel = new MessageChannel();
        let runtimeEnabled = true;
    let runtimeStateReady = false;
    let usageLogged = false;

    const setRuntimeEnabled = (enabled) => {
        runtimeEnabled = enabled !== false;
        runtimeStateReady = true;

        if (runtimeEnabled && !usageLogged) {
            usageLogged = true;
            sendLog('usage_start', location.href);
        }
    };

    const sendLog = (type, detail) => {
        if (!runtimeStateReady || !runtimeEnabled) return;
        try {
            commChannel.port1.postMessage({ type, detail });
        } catch (e) { }
    };
    
    commChannel.port1.onmessage = (event) => {
        try {
            if (event.data && event.data.action === 'setEnabled') {
                setRuntimeEnabled(event.data.enabled);
            }
        } catch (e) { }
    };

    // Relay is declared before MAIN in the manifest. Queue the transfer until
    // the current script stack is complete so the relay listener is installed.
    queueMicrotask(() => {
        try {
            window.postMessage({ type: "byfu:init", token: handshakeToken }, "*", [commChannel.port2]);
        } catch (e) { }
    });
    
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (runtimeEnabled && runtimeStateReady) {
                sendLog('info', 'Protection active.');
            }
        }, 4000);
    });

    const $apply = Reflect.apply;

    function proxyGetter(proto, prop, fakeGetter) {
        try {
            const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || typeof desc.get !== 'function') return;

            const originalGet = desc.get;
            const wrappedGet = new Proxy(originalGet, {
                apply(target, thisArg, args) {
                    if (!runtimeEnabled) return $apply(target, thisArg, args);
                    return fakeGetter(target, thisArg, args);
                }
            });

            Object.defineProperty(proto, prop, { ...desc, get: wrappedGet });
        } catch (error) { }
    }

    function proxyFunction(obj, prop, handler) {
        try {
            const original = obj && obj[prop];
            if (typeof original !== 'function') return;

            const proxy = new Proxy(original, {
                apply(target, thisArg, args) {
                    if (!runtimeEnabled) return $apply(target, thisArg, args);
                    try {
                        return handler.apply(target, thisArg, args);
                    } catch (error) {
                        return $apply(target, thisArg, args);
                    }
                }
            });

            obj[prop] = proxy;
        } catch (error) { }
    }

    // =========================================================
    // 3. VISIBILITY / FOCUS
    // =========================================================
    const falseGetter = () => false;
    const trueGetter = () => true;
    const visibleGetter = () => 'visible';

    proxyGetter(Document.prototype, 'hidden', falseGetter);
    proxyGetter(Document.prototype, 'visibilityState', visibleGetter);
    proxyFunction(Document.prototype, 'hasFocus', { apply() { return true; } });

    // =========================================================
    // 4. FULLSCREEN – PROTOTYPE LEVEL
    // =========================================================
    const fsElementGetter = (target, thisArg) => thisArg.documentElement || thisArg.body;
    proxyGetter(Document.prototype, 'fullscreenElement', fsElementGetter);
    proxyGetter(Document.prototype, 'fullscreenEnabled', () => true);

    const promiseResolver = () => Promise.resolve();
    proxyFunction(Element.prototype, 'requestFullscreen', { apply: promiseResolver });
    proxyFunction(Document.prototype, 'exitFullscreen', { apply: promiseResolver });

    // =========================================================
    // 5. HARDWARE & WEBDRIVER FINGERPRINT SPOOFING
    // =========================================================
    proxyGetter(Navigator.prototype, 'webdriver', falseGetter);
    const eightGetter = () => 8;
    proxyGetter(Navigator.prototype, 'hardwareConcurrency', eightGetter); 
    proxyGetter(Navigator.prototype, 'deviceMemory', eightGetter); 

    // =========================================================
    // 6. CANVAS PRIVACY
    // =========================================================
    const SESSION_SALT = Math.floor(Math.random() * 1000000);

    function isUniform(data) {
        if (!data || data.length < 8) return true;

        for (let i = 4; i < data.length; i += 4) {
            if (
                data[i] !== data[0] ||
                data[i + 1] !== data[1] ||
                data[i + 2] !== data[2] ||
                data[i + 3] !== data[3]
            ) {
                return false;
            }
        }
        return true;
    }

    function applyCanvasNoise(imageData, width, height) {
        const { data } = imageData;
        if (!data || isUniform(data) || width <= 0 || height <= 0) return imageData;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;

            const pixel = i / 4;
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            const n = Math.abs(((x * 127 + y * 311 + width * 17 + height * 71 + SESSION_SALT) ^ 0x5DEECE66) % 13);

            if (n === 1) data[i] = data[i] >= 254 ? 253 : data[i] + 1;
            else if (n === 2) data[i + 1] = data[i + 1] === 0 ? 1 : data[i + 1] - 1;
            else if (n === 3) data[i + 2] = data[i + 2] >= 254 ? 253 : data[i + 2] + 1;
        }

        return imageData;
    }

    function exportCanvas(target, canvas, args) {
        try {
            const ctx = canvas.getContext('2d');
            if (!ctx || canvas.width <= 0 || canvas.height <= 0) {
                return $apply(target, canvas, args);
            }

            const imageData = $apply(CanvasRenderingContext2D.prototype.getImageData, ctx, [
                0, 0, canvas.width, canvas.height
            ]);

            if (!imageData || isUniform(imageData.data)) {
                return $apply(target, canvas, args);
            }

            const offscreen = document.createElement('canvas');
            offscreen.width = canvas.width;
            offscreen.height = canvas.height;

            const offCtx = offscreen.getContext('2d');
            if (!offCtx) return $apply(target, canvas, args);

            offCtx.putImageData(
                applyCanvasNoise(imageData, canvas.width, canvas.height),
                0,
                0
            );

            return $apply(target, offscreen, args);
        } catch (error) {
            return $apply(target, canvas, args);
        }
    }

    ['toDataURL', 'toBlob'].forEach(method => {
        proxyFunction(HTMLCanvasElement.prototype, method, {
            apply(target, thisArg, args) {
                return exportCanvas(target, thisArg, args);
            }
        });
    });

    // =========================================================
    // 7. LMS INTERACTION ENGINE
    // =========================================================
    // Restore browser interactions commonly restricted by LMS pages:
    // context menu, text selection, clipboard, and drag. The engine
    // deliberately scopes its behavior to those interaction paths.

    const lmsEvents = new Set([
        'copy',
        'paste',
        'cut',
        'contextmenu',
        'selectstart',
        'dragstart'
    ]);

    const lmsShortcuts = new Set(['c', 'x', 'v', 'a']);

    const protectedMouseButtons = new Set([2]);

    const isLmsShortcut = (event) => {
        if (!event || event.type !== 'keydown') return false;

        const modifier = event.ctrlKey || event.metaKey;
        if (!modifier) return false;

        const key = typeof event.key === 'string'
            ? event.key.toLowerCase()
            : '';

        if (lmsShortcuts.has(key)) return true;

        // Shift+F10 and the dedicated Context Menu key request the
        // same browser context-menu action as a right click.
        return event.shiftKey && key === 'f10' || key === 'contextmenu';
    };

    const isLmsProtectedEvent = (event) => {
        if (!event || typeof event.type !== 'string') return false;

        const type = event.type.toLowerCase();

        if (lmsEvents.has(type) || isLmsShortcut(event)) {
            return true;
        }

        if ((type === 'mousedown' || type === 'mouseup') &&
            protectedMouseButtons.has(event.button)) {
            return true;
        }

        return false;
    };

    proxyFunction(Event.prototype, 'preventDefault', {
        apply(target, thisArg, args) {
            if (runtimeEnabled && isLmsProtectedEvent(thisArg)) {
                sendLog('lms_unlock', thisArg.type);
                return;
            }

            return $apply(target, thisArg, args);
        }
    });

    // Some LMS implementations use event.returnValue = false instead.
    try {
        const returnValue = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');

        if (returnValue && typeof returnValue.set === 'function') {
            const originalSet = returnValue.set;

            const wrappedSet = new Proxy(originalSet, {
                apply(target, thisArg, args) {
                    if (
                        runtimeEnabled &&
                        args[0] === false &&
                        isLmsProtectedEvent(thisArg)
                    ) {
                        sendLog('lms_unlock', `${thisArg.type}:returnValue`);
                        return;
                    }

                    return $apply(target, thisArg, args);
                }
            });

            Object.defineProperty(Event.prototype, 'returnValue', {
                ...returnValue,
                set: wrappedSet
            });
        }
    } catch (error) { }

    // Inline handlers can cancel context menus, selection, drag, or
    // clipboard through "return false". Normalize them as they appear.
    const inlineLmsHandlers = [
        'oncopy',
        'onpaste',
        'oncut',
        'oncontextmenu',
        'onselectstart',
        'ondragstart',
        'onkeydown'
    ];

    function hookLmsInlineHandler(proto, prop) {
        try {
            const descriptor = proto && Object.getOwnPropertyDescriptor(proto, prop);
            if (!descriptor || typeof descriptor.set !== 'function') return;

            const rawHandlers = new WeakMap();
            const originalGet = descriptor.get;
            const originalSet = descriptor.set;

            const wrappedGet = originalGet
                ? new Proxy(originalGet, {
                    apply(target, thisArg, args) {
                        const raw = rawHandlers.get(thisArg);
                        return raw || $apply(target, thisArg, args);
                    }
                })
                : originalGet;

            const wrappedSet = new Proxy(originalSet, {
                apply(target, thisArg, args) {
                    const raw = args[0];

                    if (typeof raw !== 'function') {
                        rawHandlers.delete(thisArg);
                        return $apply(target, thisArg, args);
                    }

                    const wrapped = function (event) {
                        const result = $apply(raw, this, arguments);

                        if (runtimeEnabled &&
                            result === false &&
                            isLmsProtectedEvent(event)) {
                            sendLog('lms_unlock', `${event.type}:inline`);
                            return true;
                        }

                        return result;
                    };

                    rawHandlers.set(thisArg, raw);
                    return $apply(target, thisArg, [wrapped]);
                }
            });

            Object.defineProperty(proto, prop, {
                ...descriptor,
                get: wrappedGet,
                set: wrappedSet
            });
        } catch (error) { }
    }

    const lmsWindowProto = typeof Window !== 'undefined' ? Window.prototype : null;
    const lmsPrototypes = [
        lmsWindowProto,
        typeof Document !== 'undefined' ? Document.prototype : null,
        typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null,
        typeof SVGElement !== 'undefined' ? SVGElement.prototype : null
    ];

    for (const proto of lmsPrototypes) {
        for (const prop of inlineLmsHandlers) {
            hookLmsInlineHandler(proto, prop);
        }
    }

    // CSS can disable selection/drag independently of JavaScript events.
    // Unlock only the ancestor chain involved in the current gesture rather
    // than forcing a global "* { user-select: text !important; }" rule.
    const unlockedSelection = new WeakSet();

    function unlockInteractionStyle(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

        let node = element;
        let depth = 0;

        while (node && node !== document.documentElement && depth++ < 32) {
            try {
                if (!unlockedSelection.has(node)) {
                    const style = getComputedStyle(node);

                    if (style.userSelect === 'none' ||
                        style.webkitUserSelect === 'none') {
                        node.style.setProperty('user-select', 'text', 'important');
                        node.style.setProperty('-webkit-user-select', 'text', 'important');
                        unlockedSelection.add(node);
                    }

                    if (style.webkitUserDrag === 'none') {
                        node.style.setProperty('-webkit-user-drag', 'auto', 'important');
                    }
                }
            } catch (error) { }

            node = node.parentElement;
        }
    }

    function prepareLmsGesture(event) {
        if (!runtimeEnabled || !event) return;

        const target = event.target;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) return;

        if (event.button === 0 ||
            event.type === 'pointerdown' ||
            event.type === 'mousedown') {
            unlockInteractionStyle(target);
        }
    }

    // Prepare selection/drag before the browser commits the gesture.
    window.addEventListener('pointerdown', prepareLmsGesture, true);
    window.addEventListener('mousedown', prepareLmsGesture, true);

    // Keep dynamically inserted inline handlers inside the same engine.
    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver((records) => {
            if (!runtimeEnabled) return;

            for (const record of records) {
                if (record.type === 'attributes') {
                    const target = record.target;

                    for (const prop of inlineLmsHandlers) {
                        const attribute = prop.toLowerCase();
                        if (attribute in target) {
                            try {
                                const handler = target[prop];
                                if (typeof handler === 'function') {
                                    target[prop] = handler;
                                }
                            } catch (error) { }
                        }
                    }

                    continue;
                }

                for (const node of record.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    for (const prop of inlineLmsHandlers) {
                        try {
                            const handler = node[prop];
                            if (typeof handler === 'function') {
                                node[prop] = handler;
                            }
                        } catch (error) { }
                    }

                    if (node.querySelectorAll) {
                        const descendants = node.querySelectorAll(
                            inlineLmsHandlers.map(prop => prop.slice(2)).map(type => `[on${type}]`).join(',')
                        );

                        for (const child of descendants) {
                            for (const prop of inlineLmsHandlers) {
                                try {
                                    const handler = child[prop];
                                    if (typeof handler === 'function') {
                                        child[prop] = handler;
                                    }
                                } catch (error) { }
                            }
                        }
                    }
                }
            }
        });

        try {
            observer.observe(document.documentElement || document, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: [
                    'oncopy',
                    'onpaste',
                    'oncut',
                    'oncontextmenu',
                    'onselectstart',
                    'ondragstart',
                    'onkeydown'
                ]
            });
        } catch (error) { }
    }

})();
