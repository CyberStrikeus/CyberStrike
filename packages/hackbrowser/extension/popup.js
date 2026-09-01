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
    if (!res.ok) return
    data = await res.json()
  } catch {
    return // receiver/CS unreachable — leave "-- New Session --"
  }
  sessionSelect.innerHTML = '<option value="">-- New Session --</option>'
  for (const s of data.sessions || []) {
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
