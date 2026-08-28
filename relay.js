window.addEventListener("message", function initListener(e) {
  // Dynamic token-based handshake without static prefix or signature
  if (e.source === window && e.data && typeof e.data.token === 'string' && e.data.token.length >= 10 && e.ports && e.ports[0]) {
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

