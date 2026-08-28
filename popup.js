document.addEventListener("DOMContentLoaded", async () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");

  // Window controls
  const closeBtn = document.getElementById("closeBtn");
  const maxBtn = document.getElementById("maxBtn");

  if (closeBtn) closeBtn.addEventListener("click", () => window.close());
  if (maxBtn) {
    maxBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
  }

  // Load initial state
  const data = await chrome.storage.local.get("enabled");
  const isEnabled = data.enabled !== false; // default true
  
  toggleSwitch.checked = isEnabled;
  updateUI(isEnabled);

  // Sync state if changed from full page dashboard
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      toggleSwitch.checked = changes.enabled.newValue;
      updateUI(changes.enabled.newValue);
    }
  });

  // Handle toggle change
  toggleSwitch.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    
    // Disable switch temporarily while processing
    toggleSwitch.disabled = true;
    
    chrome.runtime.sendMessage({ action: "toggle", enabled: enabled }, (response) => {
      toggleSwitch.disabled = false;
      if (response && response.success) {
        updateUI(enabled);
      } else {
        // Revert on failure
        toggleSwitch.checked = !enabled;
      }
    });
  });

  // Tab Switching
  const tabMain = document.getElementById("tabMain");
  const tabLog = document.getElementById("tabLog");
  const mainView = document.getElementById("mainView");
  const logView = document.getElementById("logView");
  const logContent = document.getElementById("logContent");
  const clearLogBtn = document.getElementById("clearLogBtn");

  let currentTabId = null;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) currentTabId = tabs[0].id;
  });

  function switchTab(showLog) {
    if (showLog) {
      tabLog.classList.add("active");
      tabMain.classList.remove("active");
      logView.classList.add("active");
      mainView.classList.remove("active");
      loadLogs();
    } else {
      tabMain.classList.add("active");
      tabLog.classList.remove("active");
      mainView.classList.add("active");
      logView.classList.remove("active");
    }
  }

  if (tabMain && tabLog) {
    tabMain.addEventListener("click", () => switchTab(false));
    tabLog.addEventListener("click", () => switchTab(true));
  }

  function loadLogs() {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ action: "getLogs", tabId: currentTabId }, (response) => {
      renderLogs(response ? response.logs : []);
    });
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logContent.innerHTML = `<div class="log-empty">No activity detected yet.</div>`;
      return;
    }
    logContent.innerHTML = logs.map(l => {
      const time = new Date(l.time).toLocaleTimeString([], { hour12: false });
      return `<div class="log-item ${l.level}">[${time}] ${l.detail || l.type}</div>`;
    }).reverse().join('');
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener("click", () => {
      if (!currentTabId) return;
      chrome.runtime.sendMessage({ action: "clearLogs", tabId: currentTabId }, () => {
        renderLogs([]);
      });
    });
  }

  function updateUI(enabled) {
    if (enabled) {
      statusText.textContent = "Active";
      statusIndicator.classList.remove("inactive");
    } else {
      statusText.textContent = "Inactive";
      statusIndicator.classList.add("inactive");
    }
  }
});
