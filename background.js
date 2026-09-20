/**
 * @fileoverview Background service worker for Byfu.
 * Handles persistent state, stats tracking, and log aggregation.
 * Content scripts are declared statically in manifest.json, so this worker
 * does not own page-script registration lifecycle.
 */

const DEFAULT_ENABLED = true;

/** @type {Record<number, Array<{time: number, type: string, detail: string, level: string, frameId: number}>>} */
const tabLogs = {};

// Clean up logs when tabs are closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLogs[tabId];
});

// Initialize persistent state once on install/update.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const data = await chrome.storage.local.get("enabled");
    if (data.enabled === undefined) {
      await chrome.storage.local.set({ enabled: DEFAULT_ENABLED });
    }
  } catch (error) {
    console.error("Initialization error:", error);
  }
});

// --- Stats Batching Logic ---
// Batch stats updates to reduce storage I/O and avoid concurrent get/set races.

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
    setTimeout(flushStats, 500);
  }
}

/**
 * Flushes pending stats to chrome.storage.local.
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

    // Restore the diff so it can be retried.
    statsDiff.usage += diffUsage;
    statsDiff.blocked += diffBlocked;
    pendingStatsUpdate = true;
    setTimeout(flushStats, 500);
  }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "toggle") {
        const enabled = message.enabled !== false;

        // Storage is the single source of truth. The isolated relay observes
        // storage changes in every frame and forwards them to MAIN.
        await chrome.storage.local.set({ enabled });

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

      if (message.from === "byfu_main") {
        const isMainFrame = sender.frameId === 0;
        const type = typeof message.type === "string" ? message.type : "unknown";

        recordStat(type, isMainFrame);

        if (sender.tab?.id !== undefined) {
          const tid = sender.tab.id;

          if (!tabLogs[tid]) tabLogs[tid] = [];

          if (isMainFrame && type === "usage_start") {
            tabLogs[tid] = [];
          }

          let level = "info";
          if (
            type.includes("block") ||
            type.includes("filtered") ||
            type.includes("success")
          ) {
            level = "success";
          } else if (type.includes("error")) {
            level = "error";
          }

          tabLogs[tid].push({
            time: Date.now(),
            type,
            detail: message.detail || type,
            level,
            frameId: sender.frameId
          });

          // Keep memory bounded.
          if (tabLogs[tid].length > 200) {
            tabLogs[tid].shift();
          }
        }

        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Message handler error:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});
