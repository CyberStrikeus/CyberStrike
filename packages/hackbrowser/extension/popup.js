// Popup: attach/detach capture on the active tab, pick session/credential. State
// lives in chrome.storage.local so it survives service-worker restarts.
// (KEEP IN SYNC with background.js DEFAULT_CS — separate runtimes, can't import.)
const DEFAULT_CS = "http://127.0.0.1:4096"

const receiverInput = document.getElementById("receiver")
const toggle = document.getElementById("toggle")
const dot = document.getElementById("dot")
const statusText = document.getElementById("statusText")
const sessionSelect = document.getElementById("sessionSelect")
const refreshSessions = document.getElementById("refreshSessions")

let tabId = null

// CyberStrike base URL — the extension talks to CS directly (its existing routes).
function csBase() {
  return (receiverInput.value || "").trim() || DEFAULT_CS
}

// Populate the session dropdown directly from CyberStrike's /session route.
async function loadSessions() {
  let sessions
  try {
    const res = await fetch(csBase() + "/session?limit=20&roots=true")
    if (!res.ok) throw new Error(String(res.status))
    sessions = await res.json()
  } catch {
    sessionSelect.innerHTML = '<option value="">-- CyberStrike unreachable — click ↻ --</option>'
    return
  }
  const active = (await chrome.storage.local.get("session")).session || ""
  sessionSelect.innerHTML = '<option value="">-- New Session --</option>'
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || typeof s.id !== "string") continue
    const o = document.createElement("option")
    o.value = s.id
    o.textContent = s.title ? s.title.slice(0, 34) : s.id
    if (s.id === active) o.selected = true
    sessionSelect.appendChild(o)
  }
}

// Selection is extension-local (CyberStrike has no "active session" concept);
// background stamps ingest with this id.
async function selectSession() {
  await chrome.storage.local.set({ session: sessionSelect.value })
}

sessionSelect.addEventListener("change", selectSession)
refreshSessions.addEventListener("click", loadSessions)

// --- Credential (this profile's identity, §3.1) ---
const credLabel = document.getElementById("credLabel")
const registerCred = document.getElementById("registerCred")
const credStatus = document.getElementById("credStatus")

async function loadCredential() {
  const o = await chrome.storage.local.get("credential")
  if (o && o.credential) {
    credLabel.value = o.credential.label || ""
    credStatus.textContent = `credential: ${o.credential.label} (${o.credential.id.slice(0, 10)}…)`
  } else {
    credStatus.textContent = "no credential"
  }
}

registerCred.addEventListener("click", async () => {
  const label = credLabel.value.trim()
  if (!label) {
    credStatus.textContent = "enter a label first"
    return
  }
  const sid = (await chrome.storage.local.get("session")).session || ""
  if (!sid) {
    credStatus.textContent = "select a session first"
    return
  }
  credStatus.textContent = "registering…"
  try {
    const res = await fetch(csBase() + `/session/${sid}/web/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    })
    const d = await res.json()
    if (d && d.id) {
      await chrome.storage.local.set({ credential: { id: d.id, label: d.label || label } })
      credStatus.textContent = `credential: ${d.label || label} (${d.id.slice(0, 10)}…)`
    } else {
      credStatus.textContent = `error: ${res.status}`
    }
  } catch {
    credStatus.textContent = "error: CyberStrike unreachable"
  }
})

function render(isAttached) {
  if (isAttached) {
    dot.classList.add("on")
    statusText.textContent = "capturing"
    toggle.textContent = "Detach capture"
    toggle.classList.add("detach")
    return
  }
  dot.classList.remove("on")
  statusText.textContent = "detached"
  toggle.textContent = "Attach capture"
  toggle.classList.remove("detach")
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tabs[0] ? tabs[0].id : null

  const stored = await chrome.storage.local.get("cyberstrike")
  receiverInput.value = stored && stored.cyberstrike ? stored.cyberstrike : DEFAULT_CS

  if (tabId !== null) {
    const status = await chrome.runtime.sendMessage({ type: "status", tabId })
    render(status && status.attached)
  }

  await loadSessions()
  await loadCredential()
}

receiverInput.addEventListener("change", () => {
  chrome.storage.local.set({ cyberstrike: receiverInput.value.trim() })
})

toggle.addEventListener("click", async () => {
  if (tabId === null) return
  chrome.storage.local.set({ cyberstrike: receiverInput.value.trim() })
  const status = await chrome.runtime.sendMessage({ type: "status", tabId })
  const next = status && status.attached ? "detach" : "attach"
  const res = await chrome.runtime.sendMessage({ type: next, tabId })
  render(res && res.attached)
})

init()
