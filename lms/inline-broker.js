(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime || runtime.infrastructure.inline) return;

    const handlers = new Set();
    const properties = [
        'oncopy',
        'onpaste',
        'oncut',
        'oncontextmenu',
        'onselectstart',
        'ondragstart',
        'onkeydown'
    ];

    const stores = new Map();

    const shouldBypassInlineCancellation = function (type, event) {
        if (!runtime.isEnabled()) return false;

        for (const handler of handlers) {
            try {
                if (handler(type, event) === true) return true;
            } catch (error) {
                runtime.log(
                    'error',
                    'LMS inline rule failed: ' + (error?.message || error)
                );
            }
        }

        return false;
    };

    const registerBypass = function (rule) {
        if (typeof rule !== 'function') return function () {};
        handlers.add(rule);
        return function () {
            handlers.delete(rule);
        };
    };

    function patchPrototype(proto, property) {
        if (!proto) return;

        try {
            const descriptor = Object.getOwnPropertyDescriptor(proto, property);
            if (!descriptor || typeof descriptor.set !== 'function') return;

            let propertyStore = stores.get(property);

            if (!propertyStore) {
                propertyStore = new WeakMap();
                stores.set(property, propertyStore);
            }

            const originalGet = descriptor.get;
            const originalSet = descriptor.set;

            const wrappedGet = originalGet
                ? new Proxy(originalGet, {
                    apply(target, thisArg, args) {
                        if (propertyStore.has(thisArg)) {
                            return propertyStore.get(thisArg);
                        }

                        return Reflect.apply(target, thisArg, args);
                    }
                })
                : originalGet;

            const wrappedSet = new Proxy(originalSet, {
                apply(target, thisArg, args) {
                    const raw = args[0];

                    if (typeof raw !== 'function') {
                        propertyStore.delete(thisArg);
                        return Reflect.apply(target, thisArg, args);
                    }

                    const wrapped = function (event) {
                        const result = Reflect.apply(raw, this, arguments);

                        if (
                            result === false &&
                            shouldBypassInlineCancellation(
                                property.slice(2),
                                event
                            )
                        ) {
                            runtime.log(
                                'lms_unlock',
                                (event?.type || property) + ':inline'
                            );
                            return true;
                        }

                        return result;
                    };

                    propertyStore.set(thisArg, raw);

                    return Reflect.apply(
                        target,
                        thisArg,
                        [wrapped]
                    );
                }
            });

            Object.defineProperty(proto, property, {
                ...descriptor,
                get: wrappedGet,
                set: wrappedSet
            });
        } catch (error) {
            runtime.log(
                'error',
                'Inline broker failed for ' + property + ': ' + (error?.message || error)
            );
        }
    }

    const prototypes = [
        typeof Window !== 'undefined' ? Window.prototype : null,
        typeof Document !== 'undefined' ? Document.prototype : null,
        typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null,
        typeof SVGElement !== 'undefined' ? SVGElement.prototype : null
    ];

    for (const proto of prototypes) {
        for (const property of properties) {
            patchPrototype(proto, property);
        }
    }

    function normalizeElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

        for (const property of properties) {
            try {
                const handler = element[property];

                if (typeof handler === 'function') {
                    element[property] = handler;
                }
            } catch (error) {}
        }
    }

    if (typeof MutationObserver !== 'undefined') {
        try {
            const observer = new MutationObserver(function (records) {
                if (!runtime.isEnabled()) return;

                for (const record of records) {
                    if (record.type === 'attributes') {
                        normalizeElement(record.target);
                        continue;
                    }

                    for (const node of record.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        normalizeElement(node);

                        if (node.querySelectorAll) {
                            for (const property of properties) {
                                const selector = '[' + property + ']';

                                for (const child of node.querySelectorAll(selector)) {
                                    normalizeElement(child);
                                }
                            }
                        }
                    }
                }
            });

            observer.observe(document.documentElement || document, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: properties
            });
        } catch (error) {
            runtime.log(
                'error',
                'Inline observer failed: ' + (error?.message || error)
            );
        }
    }

    runtime.infrastructure.inline = Object.freeze({
        registerBypass
    });
})();
