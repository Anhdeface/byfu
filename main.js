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
        if (type === 'blocked_event' || type === 'mutation_filtered' || type === 'success') {
            filtersTriggered = true;
        }
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
    // 7. EVENT OBSERVATION
    // =========================================================
    // Keep event handling native. We only observe a small set of lifecycle
    // events for diagnostics; no listeners are blocked or rewritten.
    const observedEvents = ['visibilitychange', 'blur', 'focusout'];

    for (const type of observedEvents) {
        window.addEventListener(type, () => {
            if (runtimeEnabled) sendLog('info', `event:${type}`);
        }, { passive: true });
    }

})();
