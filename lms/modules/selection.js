(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime) return;

    runtime.register({
        id: 'selection',

        enable(ctx) {
            this.offCancellation = ctx.interactions.registerCancellationBypass(function (event) {
                if (!event || typeof event.type !== 'string') return false;

                const type = event.type.toLowerCase();

                if (type === 'selectstart') return true;

                if (type === 'keydown') {
                    const modifier = event.ctrlKey || event.metaKey;
                    const key = typeof event.key === 'string'
                        ? event.key.toLowerCase()
                        : '';

                    return modifier && key === 'a';
                }

                return false;
            });

            this.offInline = ctx.inline.registerBypass(function (type, event) {
                if (type === 'selectstart') return true;
                if (type !== 'keydown' || !event) return false;

                const modifier = event.ctrlKey || event.metaKey;
                const key = typeof event.key === 'string'
                    ? event.key.toLowerCase()
                    : '';

                return modifier && key === 'a';
            });

            this.offPointer = ctx.input.on('pointerdown', function (event) {
                if (!runtime.isEnabled()) return;

                const target = event.target;

                if (!target || target.nodeType !== Node.ELEMENT_NODE) {
                    return;
                }

                unlockSelection(target, ctx.styles, 'selection');
            });
        },

        disable(ctx) {
            this.offCancellation?.();
            this.offInline?.();
            this.offPointer?.();

            ctx.styles.releaseOwner('selection');

            this.offCancellation = null;
            this.offInline = null;
            this.offPointer = null;
        }
    });

    function unlockSelection(element, styles, owner) {
        let node = element;
        let depth = 0;

        while (node && node !== document.documentElement && depth++ < 32) {
            try {
                const computed = getComputedStyle(node);

                if (
                    computed.userSelect === 'none' ||
                    computed.webkitUserSelect === 'none'
                ) {
                    styles.acquire(node, 'user-select', owner, 'text');
                    styles.acquire(
                        node,
                        '-webkit-user-select',
                        owner,
                        'text'
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
