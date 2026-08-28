/**
 * @fileoverview Popup UI controller.
 * Handles user interaction and displays current status.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleSwitch = /** @type {HTMLInputElement} */ (document.getElementById("toggleSwitch"));
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");

  // Window controls
  const closeBtn = document.getElementById("closeBtn");
  const maxBtn = document.getElementById("maxBtn");

  closeBtn?.addEventListener("click", () => window.close());
  maxBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  /**
   * Updates the visual UI state based on the enabled status.
   * @param {boolean} enabled 
   */
  const updateUI = (enabled) => {
    if (enabled) {
      statusText.textContent = "Active";
      statusIndicator.classList.remove("inactive");
    } else {
      statusText.textContent = "Inactive";
      statusIndicator.classList.add("inactive");
    }
  };

  try {
    // Load initial state
    const data = await chrome.storage.local.get("enabled");
    const isEnabled = data.enabled !== false; // default true
    
    toggleSwitch.checked = isEnabled;
    updateUI(isEnabled);
  } catch (error) {
    console.error("Failed to load initial state:", error);
  }

  // Sync state if changed from full page dashboard
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      const newValue = changes.enabled.newValue;
      toggleSwitch.checked = newValue;
      updateUI(newValue);
    }
  });

  // Handle toggle change using async wrapper
  toggleSwitch.addEventListener("change", async (e) => {
    const enabled = /** @type {HTMLInputElement} */ (e.target).checked;
    
    // Disable switch temporarily while processing
    toggleSwitch.disabled = true;
    
    try {
      const response = await chrome.runtime.sendMessage({ action: "toggle", enabled });
      if (response?.success) {
        updateUI(enabled);
      } else {
        throw new Error("Toggle operation failed on background script");
      }
    } catch (error) {
      console.error("Error toggling state:", error);
      // Revert UI on failure
      toggleSwitch.checked = !enabled;
    } finally {
      toggleSwitch.disabled = false;
    }
  });

  // Tab Switching Logic
  const tabMain = document.getElementById("tabMain");
  const tabLog = document.getElementById("tabLog");
  const mainView = document.getElementById("mainView");
  const logView = document.getElementById("logView");
  const logContent = document.getElementById("logContent");
  const clearLogBtn = document.getElementById("clearLogBtn");

  let currentTabId = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) currentTabId = tabs[0].id;
  } catch (err) {
    console.error("Failed to query active tab:", err);
  }

  const renderLogs = (logs) => {
    if (!logs || logs.length === 0) {
      logContent.innerHTML = `<div class="log-empty">No activity detected yet.</div>`;
      return;
    }
    
    // Use DocumentFragment or modern string interpolation for performance
    logContent.innerHTML = logs.map(l => {
      const time = new Date(l.time).toLocaleTimeString([], { hour12: false });
      return `<div class="log-item ${l.level}">[${time}] ${l.detail || l.type}</div>`;
    }).reverse().join('');
  };

  const loadLogs = async () => {
    if (!currentTabId) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: "getLogs", tabId: currentTabId });
      renderLogs(response?.logs || []);
    } catch (error) {
      console.error("Failed to load logs:", error);
      renderLogs([]);
    }
  };

  const switchTab = (showLog) => {
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
  };

  tabMain?.addEventListener("click", () => switchTab(false));
  tabLog?.addEventListener("click", () => switchTab(true));

  clearLogBtn?.addEventListener("click", async () => {
    if (!currentTabId) return;
    try {
      await chrome.runtime.sendMessage({ action: "clearLogs", tabId: currentTabId });
      renderLogs([]);
    } catch (error) {
      console.error("Failed to clear logs:", error);
    }
  });
});
