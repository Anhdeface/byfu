# Byfu

Byfu is a Manifest V3 browser extension focused on LMS interaction controls, privacy-oriented browser controls, and a modular page-runtime architecture.

The current codebase is intentionally organized so LMS capabilities can be developed, tested, enabled, disabled, and refactored independently without turning `main.js` into a monolithic hook collection.

---

## Architecture

The extension has three runtime layers:

1. **Background service worker**: persistent enabled state, statistics, and tab logs.
2. **ISOLATED relay**: bridges runtime state and logs between Chrome APIs and the MAIN world.
3. **MAIN runtime**: owns page-level browser behavior and the LMS engine.

The MAIN world is loaded in a deterministic order:

```
lms/core.js
lms/interaction-broker.js
lms/input-broker.js
lms/style-manager.js
lms/inline-broker.js
lms/modules/*.js
lms/index.js
main.js
```

This order is important because capability modules depend on the broker services created earlier in the chain.

### High-level flow

```
+---------------------- MAIN WORLD ----------------------+
|                                                        |
|  Runtime Registry                                      |
|        |                                               |
|        +---- Interaction Broker ------------------+     |
|        |        preventDefault / returnValue      |     |
|        |                                          |     |
|        +---- Input Broker ------------------------+     |
|        |        pointer / mouse / keyboard       |     |
|        |                                          |     |
|        +---- Style Manager -----------------------+     |
|        |        reversible CSS ownership          |     |
|        |                                          |     |
|        +---- Inline/DOM Broker ------------------+     |
|                                                   |     |
|          +-----------+-----------+-----------+    |     |
|          |           |           |           |    |     |
|      Context Menu  Selection  Clipboard     Drag |     |
|                                                        |
+--------------------------------------------------------+
```

The important design rule is **one browser primitive, one broker**. Capability modules register rules with brokers instead of patching the same native API independently.

---

## LMS Interaction Engine

The LMS engine is capability-oriented. Each module owns one feature and exposes an explicit lifecycle:

```
init(context)
enable(context)
disable(context)
```

The runtime registry controls module lifecycle and forwards the global enabled state to all registered capabilities.

### Current capabilities

| Module | Responsibility |
|---|---|
| `context-menu` | Context-menu interaction, right-click observation, keyboard context-menu requests |
| `selection` | Text selection cancellation, Ctrl/Cmd+A, CSS `user-select` handling, Shadow DOM ancestor traversal |
| `clipboard` | Copy, cut, paste, and Ctrl/Cmd+C/X/V cancellation paths |
| `drag` | Drag-start cancellation and CSS `-webkit-user-drag` handling |

These modules share infrastructure but do not directly depend on each other.

---

## Broker Layer

### Interaction Broker

`lms/interaction-broker.js` owns the single `Event.prototype.preventDefault` interception point and the `Event.prototype.returnValue` setter path.

Modules register cancellation-bypass rules such as:

```
interactions.registerCancellationBypass(event => {
    return event.type === 'selectstart';
});
```

That means selection, clipboard, drag, and context-menu modules do not independently patch `preventDefault`.

### Input Broker

`lms/input-broker.js` owns the shared capture listeners for:

```
pointerdown
mousedown
mouseup
keydown
```

Modules subscribe to those streams instead of installing duplicate global listeners.

### Style Manager

`lms/style-manager.js` provides reversible style ownership.

A capability acquires a property for its own owner ID and can release all of its changes later. This prevents one LMS capability from permanently overwriting another capability's state.

The selection and drag modules use this manager for CSS changes.

### Inline / DOM Broker

`lms/inline-broker.js` owns inline event-handler normalization for the relevant LMS interaction properties and keeps one shared `MutationObserver` for dynamically inserted or changed elements.

This avoids creating a separate observer in every capability module.

---

## Module Independence

A new LMS feature should be added as a capability module rather than by editing `main.js` and adding another global hook.

Example:

```
runtime.register({
    id: 'new-capability',

    enable(ctx) {
        this.off = ctx.interactions.registerCancellationBypass(event => {
            return event.type === 'example';
        });
    },

    disable() {
        this.off?.();
        this.off = null;
    }
});
```

A well-behaved module should:

- own only its capability-specific rules;
- subscribe through shared brokers;
- clean up every subscription in `disable()`;
- release every style mutation through `StyleManager`;
- avoid patching a native prototype that is already owned by a broker.

---

## Main Runtime

`main.js` is now a runtime host rather than the LMS feature container.

Its responsibilities are:

- MAIN/ISOLATED communication setup;
- runtime enabled-state synchronization;
- non-LMS page controls already owned by byfu;
- wiring the LMS runtime logger and enabled state.

Current non-LMS page controls in `main.js` include visibility/focus handling, fullscreen handling, navigator normalization, and canvas privacy behavior.

LMS-specific code should stay under `lms/`.

---

## Manifest V3 Lifecycle

Content scripts are statically declared in `manifest.json`.

This means Chrome owns injection lifecycle rather than `background.js` dynamically registering and unregistering content scripts.

The runtime enabled state is stored in `chrome.storage.local`. `relay.js` observes changes and forwards them to MAIN, where the LMS registry and other runtime components are enabled or disabled without unregistering page scripts.

All MAIN-world LMS modules use:

- `document_start`
- `all_frames: true`
- `match_about_blank: true`
- `match_origin_as_fallback: true`

---

## File Structure

```
byfu/
├── manifest.json
├── background.js
├── relay.js
├── main.js
├── lms/
│   ├── core.js
│   ├── interaction-broker.js
│   ├── input-broker.js
│   ├── style-manager.js
│   ├── inline-broker.js
│   ├── index.js
│   └── modules/
│       ├── context-menu.js
│       ├── selection.js
│       ├── clipboard.js
│       └── drag.js
├── popup.html
├── popup.css
├── popup.js
├── dashboard.html
├── dashboard.css
├── dashboard.js
├── img/
│   └── logo.png
├── LICENSE
└── README.md
```

---

## Installation

1. Clone or download the repository.
2. Open `chrome://extensions/` in Chromium/Chrome/Brave/Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository directory.

---

## Development Principles

The current architecture follows these rules:

1. **One primitive, one owner**: shared browser hooks belong to a broker.
2. **Capabilities stay independent**: modules communicate through shared services rather than importing each other.
3. **Lifecycle is explicit**: every capability must be able to cleanly enable and disable itself.
4. **Mutations are reversible**: CSS changes use `StyleManager` ownership instead of unmanaged inline edits.
5. **Observers are centralized**: shared DOM observation belongs to infrastructure, not individual modules.
6. **`main.js` stays small**: new LMS features should normally be added under `lms/`.

---

## Technical Specifications

| Parameter | Specification |
|:---|:---|
| Extension Platform | Manifest V3 |
| Target Execution Worlds | `MAIN` + `ISOLATED` |
| Script Injection Timing | `document_start` |
| Frame Coverage | All frames |
| Required Permissions | `storage` |
| Host Permissions | `<all_urls>` |
| LMS Architecture | Registry + Brokers + Capability Modules |
| Runtime State | `chrome.storage.local` |
| Tab Log Memory | Bounded to 200 log entries per tab |

---

## License

This project is licensed under the terms defined in `LICENSE`.