(function () {
    'use strict';

    const KEY = Symbol.for('byfu.lms.runtime.v1');

    if (globalThis[KEY]) return;

    const modules = new Map();
    let enabled = true;
    let logger = function () {};

    const runtime = {
        version: 1,
        modules,
        infrastructure: {},

        isEnabled() {
            return enabled;
        },

        setLogger(nextLogger) {
            logger = typeof nextLogger === 'function' ? nextLogger : function () {};
        },

        log(type, detail) {
            try {
                logger(type, detail);
            } catch (error) {}
        },

        register(module) {
            if (!module || typeof module.id !== 'string' || !module.id) {
                throw new TypeError('Invalid LMS module');
            }

            if (modules.has(module.id)) {
                return modules.get(module.id).context;
            }

            const context = Object.freeze({
                runtime,
                interactions: runtime.infrastructure.interactions,
                input: runtime.infrastructure.input,
                styles: runtime.infrastructure.styles,
                inline: runtime.infrastructure.inline,
                log: function (type, detail) {
                    runtime.log(type, detail);
                }
            });

            const record = {
                module,
                context,
                active: false
            };

            modules.set(module.id, record);

            try {
                if (typeof module.init === 'function') {
                    module.init(context);
                }

                if (enabled && typeof module.enable === 'function') {
                    module.enable(context);
                    record.active = true;
                }
            } catch (error) {
                record.active = false;
                runtime.log(
                    'error',
                    'LMS module ' + module.id + ' failed: ' + (error?.message || error)
                );
            }

            return context;
        },

        setModuleEnabled(id, nextEnabled) {
            const record = modules.get(id);
            if (!record) return false;

            const shouldEnable = enabled && nextEnabled !== false;

            try {
                if (shouldEnable && !record.active) {
                    record.module.enable?.(record.context);
                    record.active = true;
                } else if (!shouldEnable && record.active) {
                    record.module.disable?.(record.context);
                    record.active = false;
                }

                return true;
            } catch (error) {
                runtime.log(
                    'error',
                    'LMS module ' + id + ' toggle failed: ' + (error?.message || error)
                );
                return false;
            }
        },

        setEnabled(nextEnabled) {
            enabled = nextEnabled !== false;

            for (const id of modules.keys()) {
                runtime.setModuleEnabled(id, enabled);
            }
        },

        destroy() {
            for (const [id, record] of modules) {
                try {
                    record.module.disable?.(record.context);
                } catch (error) {
                    runtime.log(
                        'error',
                        'LMS module ' + id + ' cleanup failed: ' + (error?.message || error)
                    );
                }
                modules.delete(id);
            }
        }
    };

    globalThis[KEY] = runtime;
})();
