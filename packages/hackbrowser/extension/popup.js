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
const server = document.getElementById("server")
const save = document.getElementById("save")

// Server target. In a managed spawn the server URL rides in on the target-URL hash (#__cs_url); a
// MANUALLY load-unpacked extension has no hash, so this field is how the operator points it at the
// running CyberStrike (default 127.0.0.1:4096, or a random port when 4096 was taken). background.js
// reads the `cyberstrike` storage key (falling back to the default), so writing it here is all that's
// needed to (re)bind.
const DEFAULT_CS = "http://127.0.0.1:4096"
chrome.storage.local.get("cyberstrike", (o) => {
  server.value = (o && o.cyberstrike) || DEFAULT_CS
})

save.addEventListener("click", async () => {
  let base = (server.value || "").trim().replace(/\/+$/, "")
  if (base && !/^https?:\/\//i.test(base)) base = "http://" + base
  try {
    new URL(base)
  } catch {
    hint.textContent = "invalid server URL"
    return
  }
  // A new server means any stored session/credential belongs to the OLD server — clear them so the
  // next capture rebinds (background's ensureSession re-creates one against the new base).
  await chrome.storage.local.set({ cyberstrike: base })
  await chrome.storage.local.remove(["session", "credential"])
  server.value = base
  hint.textContent = "saved — reload the page to rebind"
})

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
