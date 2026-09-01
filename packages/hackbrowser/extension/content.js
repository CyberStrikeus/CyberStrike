// CyberStrike HackBrowser 2.0 — overlay (content script).
//
// Injects a small status panel on every page (§S4: overlay always via content
// script, never CDP — leak-free, works on real Chrome and CfT alike). Houses the
// co-driving handover toggle: even before the AI control loop exists, flipping to
// "You're driving" tags captured traffic as driver:"human", so human-found requests
// are distinguishable from AI-found ones (§6.4 blind-spot signal).
//
// Isolated in a shadow root so the target page's CSS can't touch it.

;(function () {
  if (window !== window.top) return // top frame only

  const host = document.createElement("div")
  host.id = "cyberstrike-overlay-host"
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;"
  const root = host.attachShadow({ mode: "closed" })

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        font: 12px system-ui, sans-serif;
        background: #0b0f14; color: #d7e0ea;
        border: 1px solid #24313d; border-radius: 10px;
        padding: 10px 12px; width: 200px;
        box-shadow: 0 8px 28px rgba(0,0,0,.45);
      }
      .row { display: flex; align-items: center; gap: 6px; }
      .title { color: #4ade80; font-weight: 700; letter-spacing: .04em; font-size: 11px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7684; }
      .dot.on { background: #4ade80; }
      .count { margin-left: auto; font-variant-numeric: tabular-nums; color: #8aa0b4; }
      button {
        width: 100%; margin-top: 9px; padding: 7px; border: 0; border-radius: 7px;
        font-weight: 600; cursor: pointer; background: #1f6feb; color: #fff;
      }
      button.human { background: #d29922; color: #1a1205; }
      .hint { margin-top: 6px; font-size: 10px; color: #6b7684; }
    </style>
    <div class="panel">
      <div class="row">
        <span class="dot" id="dot"></span>
        <span class="title">CYBERSTRIKE</span>
        <span class="count" id="count">0</span>
      </div>
      <button id="handover">AI is driving</button>
      <div class="hint" id="hint">capture attached to this tab</div>
    </div>
  `
  const dot = root.getElementById("dot")
  const count = root.getElementById("count")
  const handover = root.getElementById("handover")
  const hint = root.getElementById("hint")

  let driver = "ai"

  function render(status) {
    if (status && status.attached) {
      dot.classList.add("on")
    } else {
      dot.classList.remove("on")
    }
    if (status && typeof status.count === "number") count.textContent = String(status.count)
    if (status && status.driver) driver = status.driver
    if (driver === "human") {
      handover.textContent = "You're driving — give back to AI"
      handover.classList.add("human")
      hint.textContent = "your clicks are captured as 'human'"
    } else {
      handover.textContent = "AI is driving — take over"
      handover.classList.remove("human")
      hint.textContent = "capture attached to this tab"
    }
  }

  handover.addEventListener("click", () => {
    driver = driver === "ai" ? "human" : "ai"
    chrome.runtime.sendMessage({ type: "set-driver", driver }, (res) => render(res))
  })

  function poll() {
    chrome.runtime.sendMessage({ type: "overlay-status" }, (res) => {
      if (chrome.runtime.lastError) return // service worker asleep — try next tick
      render(res)
    })
  }

  function mount() {
    if (!document.body) return
    if (document.getElementById("cyberstrike-overlay-host")) return
    document.body.appendChild(host)
    poll()
    setInterval(poll, 1500)
  }

  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
})()
