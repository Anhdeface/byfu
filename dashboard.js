document.addEventListener("DOMContentLoaded", async () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");

  // Window controls for Dashboard
  const closeBtn = document.getElementById("closeBtn");
  
  // In full page, this just closes the tab
  if (closeBtn) closeBtn.addEventListener("click", () => window.close());

  const statUsage = document.getElementById("statUsage");
  const statBlocked = document.getElementById("statBlocked");

  function updateStats(data) {
    if (statUsage) statUsage.textContent = (data.stats_usage || 0).toLocaleString();
    if (statBlocked) statBlocked.textContent = (data.stats_blocked || 0).toLocaleString();
  }

  // Load initial state
  const data = await chrome.storage.local.get(["enabled", "stats_usage", "stats_blocked"]);
  const isEnabled = data.enabled !== false; // default true
  
  toggleSwitch.checked = isEnabled;
  updateUI(isEnabled);
  updateStats(data);

  // Sync state if changed from popup or scripts
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled) {
        toggleSwitch.checked = changes.enabled.newValue;
        updateUI(changes.enabled.newValue);
      }
      
      let newStats = {};
      let hasStatsChange = false;
      if (changes.stats_usage) { newStats.stats_usage = changes.stats_usage.newValue; hasStatsChange = true; }
      if (changes.stats_blocked) { newStats.stats_blocked = changes.stats_blocked.newValue; hasStatsChange = true; }
      
      if (hasStatsChange) {
        chrome.storage.local.get(["stats_usage", "stats_blocked"], updateStats);
      }
    }
  });

  // Handle toggle change
  toggleSwitch.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    
    toggleSwitch.disabled = true;
    
    chrome.runtime.sendMessage({ action: "toggle", enabled: enabled }, (response) => {
      toggleSwitch.disabled = false;
      if (response && response.success) {
        updateUI(enabled);
      } else {
        toggleSwitch.checked = !enabled;
      }
    });
  });

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
