(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime) return;

    runtime.register({
        id: 'drag',

        enable(ctx) {
            this.offCancellation = ctx.interactions.registerCancellationBypass(function (event) {
                return event?.type?.toLowerCase() === 'dragstart';
            });

            this.offInline = ctx.inline.registerBypass(function (type) {
                return type === 'dragstart';
            });

            this.offPointer = ctx.input.on('pointerdown', function (event) {
                if (!runtime.isEnabled()) return;

                const target = event.target;

                if (!target || target.nodeType !== Node.ELEMENT_NODE) {
                    return;
                }

                unlockDrag(target, ctx.styles, 'drag');
            });
        },

        disable(ctx) {
            this.offCancellation?.();
            this.offInline?.();
            this.offPointer?.();

            ctx.styles.releaseOwner('drag');

            this.offCancellation = null;
            this.offInline = null;
            this.offPointer = null;
        }
    });

    function unlockDrag(element, styles, owner) {
        let node = element;
        let depth = 0;

        while (node && node !== document.documentElement && depth++ < 32) {
            try {
                const computed = getComputedStyle(node);

                if (computed.webkitUserDrag === 'none') {
                    styles.acquire(
                        node,
                        '-webkit-user-drag',
                        owner,
                        'auto'
                    );
                }
            } catch (error) {}

            const root = node.getRootNode?.();

            if (root && root instanceof ShadowRoot && root.host) {
                node = root.host;
            } else {
                node = node.parentElement;
            }
        }
    }
})();
