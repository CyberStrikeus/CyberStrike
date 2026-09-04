// Popup: a master enable/disable switch + a show/hide toggle for the on-page panel.
//
// The on-page panel (dock) is the whole control surface, so the popup stays minimal. The power
// switch flips a persisted `enabled` flag in chrome.storage.local; content scripts and the
// background both watch it — disabling detaches every tab (capture stops, the control channel
// closes) and removes the injected UI, so nothing keeps running in the background. The show/hide
// button (re)injects the content script first, which fixes a fresh profile that missed the initial
// injection. Injections are idempotent.
const power = document.getElementById("power")
const toggle = document.getElementById("toggle")
const hint = document.getElementById("hint")

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

async function inject(tab) {
  // MAIN-world capture patch, then the isolated-world panel. Both guard against double-injection.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture-patch.js"], world: "MAIN" })
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
}

function reflect() {
  power.classList.toggle("off", !enabled)
  power.title = enabled ? "Enabled — click to disable" : "Disabled — click to enable"
  toggle.disabled = !enabled
  hint.textContent = enabled ? "" : "Disabled — nothing runs until you turn it back on."
}

let enabled = true
chrome.storage.local.get("enabled", (o) => {
  enabled = !(o && o.enabled === false)
  reflect()
})

// Master on/off. Persisting the flag is what actually enables/disables everything (content scripts +
// background watch it); on enable we also inject the active tab so the panel comes up right away.
power.addEventListener("click", async () => {
  enabled = !enabled
  await chrome.storage.local.set({ enabled })
  reflect()
  if (enabled) {
    const tab = await activeTab()
    if (tab && tab.id && /^https?:/.test(tab.url || "")) {
      try {
        await inject(tab)
      } catch {}
    }
  }
})

// Show / hide the on-page panel (only meaningful while enabled).
toggle.addEventListener("click", async () => {
  if (!enabled) return
  const tab = await activeTab()
  if (!tab || !tab.id) {
    hint.textContent = "no active tab"
    return
  }
  if (!/^https?:/.test(tab.url || "")) {
    hint.textContent = "open a website first (http/https)"
    return
  }
  try {
    await inject(tab)
  } catch (e) {
    hint.textContent = "inject failed: " + (e && e.message ? e.message : String(e))
    return
  }
  chrome.tabs.sendMessage(tab.id, { type: "panel-visibility", action: "toggle" }, () => {
    void chrome.runtime.lastError
    window.close()
  })
})
