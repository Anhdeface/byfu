(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime) return;

    runtime.register({
        id: 'clipboard',

        enable(ctx) {
            this.offCancellation = ctx.interactions.registerCancellationBypass(function (event) {
                if (!event || typeof event.type !== 'string') return false;

                const type = event.type.toLowerCase();

                if (
                    type === 'copy' ||
                    type === 'paste' ||
                    type === 'cut'
                ) {
                    return true;
                }

                if (type === 'keydown') {
                    const modifier = event.ctrlKey || event.metaKey;

                    if (!modifier) return false;

                    const key = typeof event.key === 'string'
                        ? event.key.toLowerCase()
                        : '';

                    return key === 'c' ||
                        key === 'x' ||
                        key === 'v';
                }

                return false;
            });

            this.offInline = ctx.inline.registerBypass(function (type, event) {
                if (
                    type === 'copy' ||
                    type === 'paste' ||
                    type === 'cut'
                ) {
                    return true;
                }

                if (type !== 'keydown' || !event) return false;

                const modifier = event.ctrlKey || event.metaKey;
                if (!modifier) return false;

                const key = typeof event.key === 'string'
                    ? event.key.toLowerCase()
                    : '';

                return key === 'c' ||
                    key === 'x' ||
                    key === 'v';
            });
        },

        disable() {
            this.offCancellation?.();
            this.offInline?.();

            this.offCancellation = null;
            this.offInline = null;
        }
    });
})();
