(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime) return;

    const required = [
        'interactions',
        'input',
        'styles',
        'inline'
    ];

    const missing = required.filter(function (key) {
        return !runtime.infrastructure[key];
    });

    if (missing.length) {
        runtime.log(
            'error',
            'LMS engine bootstrap incomplete: ' + missing.join(', ')
        );
    }
})();
