/**
 * @fileoverview Dashboard UI controller.
 * Handles the full-page dashboard logic, displaying stats and toggling state.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleSwitch = /** @type {HTMLInputElement} */ (document.getElementById("toggleSwitch"));
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");

  // Window controls for Dashboard
  const closeBtn = document.getElementById("closeBtn");
  
  // In full page, this just closes the tab
  closeBtn?.addEventListener("click", () => window.close());

  const statUsage = document.getElementById("statUsage");
  const statBlocked = document.getElementById("statBlocked");

  /**
   * Updates the statistical numbers on the dashboard.
   * @param {{stats_usage?: number, stats_blocked?: number}} data 
   */
  const updateStats = (data) => {
    if (statUsage) statUsage.textContent = (data.stats_usage || 0).toLocaleString();
    if (statBlocked) statBlocked.textContent = (data.stats_blocked || 0).toLocaleString();
  };

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
    const data = await chrome.storage.local.get(["enabled", "stats_usage", "stats_blocked"]);
    const isEnabled = data.enabled !== false; // default true
    
    toggleSwitch.checked = isEnabled;
    updateUI(isEnabled);
    updateStats(data);
  } catch (error) {
    console.error("Failed to load initial dashboard state:", error);
  }

  // Sync state if changed from popup or scripts
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled) {
        const newValue = changes.enabled.newValue;
        toggleSwitch.checked = newValue;
        updateUI(newValue);
      }
      
      let hasStatsChange = false;
      if (changes.stats_usage || changes.stats_blocked) {
        hasStatsChange = true;
      }
      
      if (hasStatsChange) {
        // Fetch fresh stats to ensure accuracy (or just use changes.xxx.newValue)
        chrome.storage.local.get(["stats_usage", "stats_blocked"])
          .then(updateStats)
          .catch(err => console.error("Error syncing stats:", err));
      }
    }
  });

  // Handle toggle change with async logic
  toggleSwitch.addEventListener("change", async (e) => {
    const enabled = /** @type {HTMLInputElement} */ (e.target).checked;
    
    toggleSwitch.disabled = true;
    
    try {
      const response = await chrome.runtime.sendMessage({ action: "toggle", enabled });
      if (response?.success) {
        updateUI(enabled);
      } else {
        throw new Error("Dashboard toggle failed on background script");
      }
    } catch (error) {
      console.error("Error toggling state from dashboard:", error);
      // Revert UI on failure
      toggleSwitch.checked = !enabled;
    } finally {
      toggleSwitch.disabled = false;
    }
  });
});
