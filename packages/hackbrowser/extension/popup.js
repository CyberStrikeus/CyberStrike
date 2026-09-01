// Popup: attach/detach the Network capture on the active tab, and configure
// the receiver endpoint. State lives in chrome.storage.local so it survives
// service-worker restarts.

const receiverInput = document.getElementById("receiver")
const toggle = document.getElementById("toggle")
const dot = document.getElementById("dot")
const statusText = document.getElementById("statusText")
const sessionSelect = document.getElementById("sessionSelect")
const refreshSessions = document.getElementById("refreshSessions")

let tabId = null

// Receiver base URL (strip the /capture path) — sessions live at <base>/sessions.
function receiverBase() {
  const raw = (receiverInput.value || "").trim() || "http://127.0.0.1:4097/capture"
  return raw.replace(/\/capture$/, "")
}

// Populate the session dropdown from the receiver (which proxies CyberStrike).
async function loadSessions() {
  let data
  try {
    const res = await fetch(receiverBase() + "/sessions")
    if (!res.ok) throw new Error(String(res.status))
    data = await res.json()
  } catch {
    // Make the failure visible instead of a silently-empty dropdown.
    sessionSelect.innerHTML = '<option value="">-- receiver/CS unreachable — click ↻ --</option>'
    return
  }
  const sessions = data.sessions || []
  sessionSelect.innerHTML = '<option value="">-- New Session --</option>'
  for (const s of sessions) {
    const o = document.createElement("option")
    o.value = s.id
    o.textContent = s.title ? s.title.slice(0, 34) : s.id
    if (s.id === data.active) o.selected = true
    sessionSelect.appendChild(o)
  }
}

async function selectSession() {
  try {
    await fetch(receiverBase() + "/select-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionID: sessionSelect.value }),
    })
  } catch {
    // best-effort; selection re-applies on next change
  }
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
  credStatus.textContent = "registering…"
  try {
    const res = await fetch(receiverBase() + "/register-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    })
    const d = await res.json()
    if (d.ok) {
      await chrome.storage.local.set({ credential: { id: d.id, label: d.label } })
      credStatus.textContent = `credential: ${d.label} (${d.id.slice(0, 10)}…)`
    } else {
      credStatus.textContent = `error: ${d.error || res.status}`
    }
  } catch {
    credStatus.textContent = "error: receiver unreachable"
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

  const stored = await chrome.storage.local.get("receiver")
  receiverInput.value = stored && stored.receiver ? stored.receiver : "http://127.0.0.1:4097/capture"

  if (tabId !== null) {
    const status = await chrome.runtime.sendMessage({ type: "status", tabId })
    render(status && status.attached)
  }

  await loadSessions()
  await loadCredential()
}

receiverInput.addEventListener("change", () => {
  chrome.storage.local.set({ receiver: receiverInput.value.trim() })
})

toggle.addEventListener("click", async () => {
  if (tabId === null) return
  chrome.storage.local.set({ receiver: receiverInput.value.trim() })
  const status = await chrome.runtime.sendMessage({ type: "status", tabId })
  const next = status && status.attached ? "detach" : "attach"
  const res = await chrome.runtime.sendMessage({ type: next, tabId })
  render(res && res.attached)
})

init()
