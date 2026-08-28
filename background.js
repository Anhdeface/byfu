/**
 * @fileoverview Background service worker for Byfu.
 * Handles script registration, stats tracking, and log aggregation.
 * Implements modern JS async patterns, batched storage writes, and prevents race conditions.
 */

const SCRIPT_ID = "byfu_main_script";

/** @type {Record<number, Array<{time: number, type: string, detail: string, level: string, frameId: number}>>} */
const tabLogs = {};

// Clean up logs when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLogs[tabId];
});

// Mutex queue to prevent race conditions during rapid state toggling
let updateMutex = Promise.resolve();

/**
 * Updates the registration state of the content scripts.
 * Uses a promise queue to ensure sequential execution.
 * @param {boolean} enabled - Whether the extension should be active.
 * @returns {Promise<void>}
 */
async function updateScriptState(enabled) {
  updateMutex = updateMutex.then(async () => {
    try {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const isRegistered = scripts.some(s => s.id === SCRIPT_ID);
      
      if (isRegistered) {
        await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID, `${SCRIPT_ID}_relay`] });
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
            id: `${SCRIPT_ID}_relay`,
            js: ["relay.js"],
            matches: ["<all_urls>"],
            runAt: "document_start",
            allFrames: true,
            world: "ISOLATED"
          }
        ]);
      }
    } catch (error) {
      console.error("Failed to update script state:", error);
      throw error; // Let the queue catcher handle it
    }
  }).catch(error => {
    console.error("Error in update queue:", error);
  });
  
  return updateMutex;
}

// Initialize on install or update
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const data = await chrome.storage.local.get("enabled");
    const isEnabled = data.enabled !== false; // Default to true
    if (data.enabled === undefined) {
      await chrome.storage.local.set({ enabled: true });
    }
    await updateScriptState(isEnabled);
  } catch (error) {
    console.error("Initialization error:", error);
  }
});

// Ensure state is correct when service worker wakes up
chrome.storage.local.get("enabled", (data) => {
  const isEnabled = data.enabled !== false;
  updateScriptState(isEnabled).catch(console.error);
});

// --- Stats Batching Logic ---
// We batch stats updates to prevent Chrome storage race conditions and reduce IO operations.

let pendingStatsUpdate = false;
let statsDiff = { usage: 0, blocked: 0 };

/**
 * Records a stat change locally and debounces the save to storage.
 * @param {string} type - The type of message received.
 * @param {boolean} isMainFrame - Whether the sender is the top-level frame.
 */
function recordStat(type, isMainFrame) {
  let changed = false;
  if (type === "usage_start" && isMainFrame) {
    statsDiff.usage++;
    changed = true;
  } else if (type.includes("block") || type.includes("filtered")) {
    statsDiff.blocked++;
    changed = true;
  }
  
  if (changed && !pendingStatsUpdate) {
    pendingStatsUpdate = true;
    setTimeout(flushStats, 500); // Flush every 500ms
  }
}

/**
 * Flushes pending stats to chrome.storage.local atomically.
 */
async function flushStats() {
  if (!pendingStatsUpdate) return;
  pendingStatsUpdate = false;
  
  const diffUsage = statsDiff.usage;
  const diffBlocked = statsDiff.blocked;
  statsDiff.usage = 0;
  statsDiff.blocked = 0;
  
  if (diffUsage === 0 && diffBlocked === 0) return;

  try {
    const data = await chrome.storage.local.get(["stats_usage", "stats_blocked"]);
    await chrome.storage.local.set({
      stats_usage: (data.stats_usage || 0) + diffUsage,
      stats_blocked: (data.stats_blocked || 0) + diffBlocked
    });
  } catch (error) {
    console.error("Failed to flush stats:", error);
    // Restore diff on failure for next attempt
    statsDiff.usage += diffUsage;
    statsDiff.blocked += diffBlocked;
    pendingStatsUpdate = true;
  }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use IIFE to handle async operations properly without breaking the listener paradigm
  (async () => {
    try {
      if (message.action === "toggle") {
        await chrome.storage.local.set({ enabled: message.enabled });
        await updateScriptState(message.enabled);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "getLogs") {
        sendResponse({ logs: tabLogs[message.tabId] || [] });
        return;
      }
      
      if (message.action === "clearLogs") {
        tabLogs[message.tabId] = [];
        sendResponse({ success: true });
        return;
      }

      // Handle stats and logging from content scripts
      if (message.from === "byfu_main") {
        const isMainFrame = sender.frameId === 0;
        recordStat(message.type, isMainFrame);

        if (sender.tab?.id) {
          const tid = sender.tab.id;
          if (!tabLogs[tid]) tabLogs[tid] = [];
          
          if (isMainFrame && message.type === "usage_start") {
            tabLogs[tid] = []; // Clear on top-level reload
          }
          
          let level = "info";
          if (message.type.includes("block") || message.type.includes("filtered") || message.type.includes("success")) {
            level = "success";
          } else if (message.type.includes("error")) {
            level = "error";
          }
          
          tabLogs[tid].push({
            time: Date.now(),
            type: message.type,
            detail: message.detail || message.type,
            level: level,
            frameId: sender.frameId
          });
          
          // Keep memory bounded: retain last 200 logs per tab
          if (tabLogs[tid].length > 200) tabLogs[tid].shift();
        }
        
        // Return early since we don't send a response for stats
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Message handler error:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep the message channel open for async sendResponse
});
