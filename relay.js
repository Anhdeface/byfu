const INTERNAL_BRIDGE = "__byfu_evt_bridge__";

document.addEventListener(INTERNAL_BRIDGE, (event) => {
  // Prevent any website event listeners from receiving this event
  event.stopImmediatePropagation();
  try {
    if (event.detail) {
      chrome.runtime.sendMessage({
        from: "byfu_main",
        type: event.detail.type,
        detail: event.detail.detail
      }).catch(() => {});
    }
  } catch(e) {}
}, true); // Use capturing phase to intercept before bubbling

