window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.from !== "byfu_main") return;
  try {
    chrome.runtime.sendMessage(event.data).catch(() => {});
  } catch(e) {}
});
