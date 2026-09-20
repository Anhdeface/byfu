(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime) return;

    runtime.register({
        id: 'context-menu',

        enable(ctx) {
            this.offCancellation = ctx.interactions.registerCancellationBypass(function (event) {
                if (!event || typeof event.type !== 'string') return false;

                const type = event.type.toLowerCase();

                if (type === 'contextmenu') {
                    return true;
                }

                if (type === 'keydown') {
                    const key = typeof event.key === 'string'
                        ? event.key.toLowerCase()
                        : '';

                    return key === 'contextmenu' ||
                        (event.shiftKey && key === 'f10');
                }

                return false;
            });

            this.offInline = ctx.inline.registerBypass(function (type, event) {
                if (type === 'contextmenu') return true;
                if (type !== 'keydown' || !event) return false;

                const key = typeof event.key === 'string'
                    ? event.key.toLowerCase()
                    : '';

                return key === 'contextmenu' ||
                    (event.shiftKey && key === 'f10');
            });

            this.offPointer = ctx.input.on('mousedown', function (event) {
                if (event.button === 2) {
                    ctx.log('lms_menu', 'right-click');
                }
            });
        },

        disable() {
            this.offCancellation?.();
            this.offInline?.();
            this.offPointer?.();

            this.offCancellation = null;
            this.offInline = null;
            this.offPointer = null;
        }
    });
})();
