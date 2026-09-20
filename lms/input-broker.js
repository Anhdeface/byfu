(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime || runtime.infrastructure.input) return;

    const listeners = new Map();
    const types = ['pointerdown', 'mousedown', 'mouseup', 'keydown'];

    const on = function (type, handler) {
        if (!types.includes(type) || typeof handler !== 'function') {
            return function () {};
        }

        let bucket = listeners.get(type);

        if (!bucket) {
            bucket = new Set();
            listeners.set(type, bucket);
        }

        bucket.add(handler);

        return function () {
            bucket.delete(handler);
        };
    };

    const dispatch = function (event) {
        const bucket = listeners.get(event.type);
        if (!bucket || bucket.size === 0) return;

        for (const handler of bucket) {
            try {
                handler(event);
            } catch (error) {
                runtime.log(
                    'error',
                    'LMS input handler failed: ' + (error?.message || error)
                );
            }
        }
    };

    for (const type of types) {
        window.addEventListener(type, dispatch, true);
    }

    runtime.infrastructure.input = Object.freeze({
        on,
        supportedTypes: Object.freeze(types.slice())
    });
})();
