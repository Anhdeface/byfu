// Use camouflage string that mimics a highly common, benign extension (React DevTools)
const INIT_MSG = "__react_devtools_init__";

window.addEventListener("message", function initListener(e) {
  // Only accept initialization from our own window
  if (e.source === window && e.data === INIT_MSG && e.ports && e.ports[0]) {
    // Hide this initialization event from the target page completely
    e.stopImmediatePropagation();
    window.removeEventListener("message", initListener, true);
    
    const port = e.ports[0];
    port.onmessage = (msg) => {
      try {
        if (msg.data) {
          chrome.runtime.sendMessage({
            from: "byfu_main",
            type: msg.data.type,
            detail: msg.data.detail
          }).catch(() => {});
        }
      } catch(err) {}
    };
  }
}, true); // Capturing phase intercepts it before page scripts

