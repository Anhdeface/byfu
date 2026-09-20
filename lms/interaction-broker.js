(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime || runtime.infrastructure.interactions) return;

    const cancellationRules = new Set();
    let preventDefaultPatched = false;
    let returnValuePatched = false;

    const shouldBypassCancellation = function (event) {
        if (!runtime.isEnabled() || !event) return false;

        for (const rule of cancellationRules) {
            try {
                if (rule(event) === true) return true;
            } catch (error) {
                runtime.log(
                    'error',
                    'LMS interaction rule failed: ' + (error?.message || error)
                );
            }
        }

        return false;
    };

    const registerCancellationBypass = function (rule) {
        if (typeof rule !== 'function') return function () {};
        cancellationRules.add(rule);
        return function () {
            cancellationRules.delete(rule);
        };
    };

    if (typeof Event !== 'undefined' && Event.prototype) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(
                Event.prototype,
                'preventDefault'
            );
            const original = descriptor?.value;

            if (typeof original === 'function') {
                const wrapped = new Proxy(original, {
                    apply(target, thisArg, args) {
                        if (shouldBypassCancellation(thisArg)) {
                            runtime.log(
                                'lms_unlock',
                                thisArg.type || 'unknown'
                            );
                            return;
                        }

                        return Reflect.apply(target, thisArg, args);
                    }
                });

                Object.defineProperty(Event.prototype, 'preventDefault', {
                    ...descriptor,
                    value: wrapped
                });

                preventDefaultPatched = true;
            }
        } catch (error) {
            runtime.log(
                'error',
                'preventDefault broker failed: ' + (error?.message || error)
            );
        }

        try {
            const descriptor = Object.getOwnPropertyDescriptor(
                Event.prototype,
                'returnValue'
            );
            const originalSetter = descriptor?.set;

            if (typeof originalSetter === 'function') {
                const wrappedSetter = new Proxy(originalSetter, {
                    apply(target, thisArg, args) {
                        if (args[0] === false && shouldBypassCancellation(thisArg)) {
                            runtime.log(
                                'lms_unlock',
                                (thisArg?.type || 'unknown') + ':returnValue'
                            );
                            return;
                        }

                        return Reflect.apply(target, thisArg, args);
                    }
                });

                Object.defineProperty(Event.prototype, 'returnValue', {
                    ...descriptor,
                    set: wrappedSetter
                });

                returnValuePatched = true;
            }
        } catch (error) {
            runtime.log(
                'error',
                'returnValue broker failed: ' + (error?.message || error)
            );
        }
    }

    runtime.infrastructure.interactions = Object.freeze({
        registerCancellationBypass,
        isPreventDefaultPatched: function () {
            return preventDefaultPatched;
        },
        isReturnValuePatched: function () {
            return returnValuePatched;
        }
    });
})();
