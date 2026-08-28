const SCRIPT_ID = "byfu_main_script";
const tabLogs = {};

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLogs[tabId];
});

async function updateScriptState(enabled) {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const isRegistered = scripts.some(s => s.id === SCRIPT_ID);
    
    if (isRegistered) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID, SCRIPT_ID + "_relay"] });
    }
    
    if (enabled) {
      await chrome.scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          js: ["main.js"],
          matches: ["<all_urls>"],
          runAt: "document_start",
          allFrames: true,
          world: "MAIN"
        },
        {
          id: SCRIPT_ID + "_relay",
          js: ["relay.js"],
          matches: ["<all_urls>"],
          runAt: "document_start",
          allFrames: true,
          world: "ISOLATED"
        }
      ]);
    }
  } catch (e) {
    console.error("Failed to update script state:", e);
  }
}

// Initialize on install or update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get("enabled");
  const isEnabled = data.enabled !== false; // Default to true
  if (data.enabled === undefined) {
    await chrome.storage.local.set({ enabled: true });
  }
  await updateScriptState(isEnabled);
});

// Ensure state is correct when service worker wakes up
chrome.storage.local.get("enabled", (data) => {
  const isEnabled = data.enabled !== false;
  updateScriptState(isEnabled);
});

// Listen for toggle from popup and stats from main.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "toggle") {
    chrome.storage.local.set({ enabled: message.enabled }).then(() => {
      updateScriptState(message.enabled).then(() => {
        sendResponse({ success: true });
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.action === "getLogs") {
    sendResponse({ logs: tabLogs[message.tabId] || [] });
    return false;
  }
  
  if (message.action === "clearLogs") {
    tabLogs[message.tabId] = [];
    sendResponse({ success: true });
    return false;
  }

  // Handle stats logging
  if (message.from === "byfu_main") {
    chrome.storage.local.get(["stats_usage", "stats_blocked"], (data) => {
      let usage = data.stats_usage || 0;
      let blocked = data.stats_blocked || 0;
      
      let changed = false;
      if (message.type === "usage_start") {
        if (sender.frameId === 0) { // only count main frame loads
          usage++;
          changed = true;
        }
      } else if (message.type.includes("block") || message.type.includes("filtered")) {
        blocked++;
        changed = true;
      }
      
      if (changed) {
        chrome.storage.local.set({ stats_usage: usage, stats_blocked: blocked });
      }
    });

    // Logging memory storage
    if (sender.tab && sender.tab.id) {
      const tid = sender.tab.id;
      if (!tabLogs[tid]) tabLogs[tid] = [];
      
      if (sender.frameId === 0 && message.type === "usage_start") {
        tabLogs[tid] = []; // clear on top-level reload
      }
      
      let level = "info";
      if (message.type.includes("block") || message.type.includes("filtered") || message.type.includes("success")) level = "success";
      if (message.type.includes("error")) level = "error";
      
      tabLogs[tid].push({
        time: Date.now(),
        type: message.type,
        detail: message.detail || message.type,
        level: level,
        frameId: sender.frameId
      });
      
      // keep only last 200 logs per tab
      if (tabLogs[tid].length > 200) tabLogs[tid].shift();
    }
  }
});
