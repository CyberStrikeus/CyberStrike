// Popup: attach/detach the Network capture on the active tab, and configure
// the receiver endpoint. State lives in chrome.storage.local so it survives
// service-worker restarts.

const receiverInput = document.getElementById("receiver")
const toggle = document.getElementById("toggle")
const dot = document.getElementById("dot")
const statusText = document.getElementById("statusText")

let tabId = null

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
