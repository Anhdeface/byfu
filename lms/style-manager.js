(function () {
    'use strict';

    const runtime = globalThis[Symbol.for('byfu.lms.runtime.v1')];
    if (!runtime || runtime.infrastructure.styles) return;

    const records = new WeakMap();
    const ownerElements = new Map();

    function rememberOwner(owner, element) {
        let elements = ownerElements.get(owner);

        if (!elements) {
            elements = new Set();
            ownerElements.set(owner, elements);
        }

        elements.add(element);
    }

    function rememberProperty(element, property) {
        let properties = records.get(element);

        if (!properties) {
            properties = new Map();
            records.set(element, properties);
        }

        let record = properties.get(property);

        if (!record) {
            record = {
                originalValue: element.style.getPropertyValue(property),
                originalPriority: element.style.getPropertyPriority(property),
                owners: new Map()
            };

            properties.set(property, record);
        }

        return record;
    }

    function write(record, element, property) {
        let last;

        for (const value of record.owners.values()) {
            last = value;
        }

        if (last) {
            element.style.setProperty(
                property,
                last.value,
                last.priority || ''
            );
            return;
        }

        if (record.originalValue) {
            element.style.setProperty(
                property,
                record.originalValue,
                record.originalPriority || ''
            );
        } else {
            element.style.removeProperty(property);
        }
    }

    function acquire(element, property, owner, value, priority) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (!property || !owner) return false;

        const record = rememberProperty(element, property);

        record.owners.set(owner, {
            value,
            priority: priority || 'important'
        });

        rememberOwner(owner, element);
        write(record, element, property);

        return true;
    }

    function release(element, property, owner) {
        const properties = records.get(element);
        const record = properties?.get(property);

        if (!record) return;

        record.owners.delete(owner);
        write(record, element, property);

        if (record.owners.size === 0) {
            properties.delete(property);
        }

        if (properties && properties.size === 0) {
            records.delete(element);
        }
    }

    function releaseOwner(owner) {
        const elements = ownerElements.get(owner);
        if (!elements) return;

        for (const element of elements) {
            const properties = records.get(element);
            if (!properties) continue;

            for (const property of [...properties.keys()]) {
                release(element, property, owner);
            }
        }

        ownerElements.delete(owner);
    }

    runtime.infrastructure.styles = Object.freeze({
        acquire,
        release,
        releaseOwner
    });
})();
