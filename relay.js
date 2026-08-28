const INIT_MSG_PREFIX = "byfu_port_";

window.addEventListener("message", function initListener(e) {
  // Use a randomized prefix to avoid static string signatures or honeypots
  if (e.source === window && typeof e.data === 'string' && e.data.startsWith(INIT_MSG_PREFIX) && e.ports && e.ports[0]) {
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

