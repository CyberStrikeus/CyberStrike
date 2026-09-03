// Minimal popup: the on-page panel (dock) is the whole control surface, so the popup is
// just a show/hide toggle. It also (re)injects the content script first, which fixes the
// case where a fresh --load-extension profile missed the initial injection (branded
// Chrome 137+ can't CLI-load extensions; we spawn Chrome for Testing, and even there a
// freshly launched profile can race the first page load). Injections are idempotent.
const btn = document.getElementById("toggle")
const hint = document.getElementById("hint")

btn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab || !tab.id) {
    hint.textContent = "no active tab"
    return
  }
  if (!/^https?:/.test(tab.url || "")) {
    hint.textContent = "open a website first (http/https)"
    return
  }
  try {
    // MAIN-world capture patch, then the isolated-world panel. Both guard against
    // double-injection internally.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture-patch.js"], world: "MAIN" })
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
  } catch (e) {
    hint.textContent = "inject failed: " + (e && e.message ? e.message : String(e))
    return
  }
  chrome.tabs.sendMessage(tab.id, { type: "panel-visibility", action: "toggle" }, () => {
    void chrome.runtime.lastError
    window.close()
  })
})
