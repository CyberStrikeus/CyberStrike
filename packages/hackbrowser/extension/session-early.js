// Runs at document_start — BEFORE the page's own scripts fire their first network request
// (and before capture-patch.js / the background webRequest listener capture anything). It
// establishes the CyberStrike session + server URL from the launcher-injected
// #__cs_sess / #__cs_url hash so the very first captured request ingests against the RIGHT
// session.
//
// content.js read this hash too, but only at document_idle — far too late: a page's early
// telemetry (e.g. analytics/RUM on load) was captured and ingested with no session, so the
// backend auto-created a WRONG new session (titled from that telemetry) and the session the
// user launched /hackbrowser in stayed empty. Reading it here, at document_start, closes that
// race.
//
// This DOES NOT strip the hash and does NOT touch the credential/UI — content.js still owns
// readCredFromHash (stripping, role pre-fill, panel setup) at document_idle. It only pre-seeds
// the two values the early capture path needs: the session and the server URL.
;(function () {
  try {
    const hash = location.hash || ""
    const decode = (match) => {
      if (!match) return null
      try {
        return decodeURIComponent(match[1])
      } catch {
        return match[1]
      }
    }
    const session = decode(hash.match(/__cs_sess=([^&]+)/))
    const csUrl = decode(hash.match(/__cs_url=([^&]+)/))
    if (!session && !csUrl) return
    const next = { spawned: true }
    if (session) next.session = session
    if (csUrl) next.cyberstrike = csUrl.replace(/\/+$/, "")
    chrome.storage.local.set(next)
  } catch {}
})()
