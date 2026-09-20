let enabledState = true;
let stateReady = false;
let pendingPort = null;
let activePort = null;

function postStateToMain(port) {
  try {
    port.postMessage({
      action: "setEnabled",
      enabled: enabledState
    });
  } catch (error) {
    if (port === activePort) {
      activePort = null;
    }
  }
}

function activatePort(port) {
  activePort = port;

  port.onmessage = (messageEvent) => {
    try {
      const data = messageEvent.data;
      if (!data || typeof data !== "object") return;

      chrome.runtime.sendMessage({
        from: "byfu_main",
        type: data.type,
        detail: data.detail
      }).catch(() => {});
    } catch (error) {
      // The relay must not throw into the page/MAIN world.
    }
  };

  postStateToMain(port);
  if (typeof port.start === "function") {
    port.start();
  }
}

// Resolve the persisted state before accepting the MAIN-world handshake.
// This avoids a transient "enabled" state when the user has disabled Byfu.
chrome.storage.local.get("enabled").then((data) => {
  enabledState = data.enabled !== false;
  stateReady = true;

  if (pendingPort) {
    const port = pendingPort;
    pendingPort = null;
    activatePort(port);
  }
}).catch(() => {
  stateReady = true;

  if (pendingPort) {
    const port = pendingPort;
    pendingPort = null;
    activatePort(port);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;

  enabledState = changes.enabled.newValue !== false;
  stateReady = true;

  if (activePort) {
    postStateToMain(activePort);
  }
});


window.addEventListener("message", function initListener(event) {
  const data = event.data;

  if (
    event.source === window &&
    data &&
    data.type === "byfu:init" &&
    typeof data.token === "string" &&
    data.token.length >= 10 &&
    event.ports &&
    event.ports[0]
  ) {
    event.stopImmediatePropagation();
    window.removeEventListener("message", initListener, true);

    const port = event.ports[0];

    if (stateReady) {
      activatePort(port);
    } else {
      pendingPort = port;
    }
  }
}, true);
