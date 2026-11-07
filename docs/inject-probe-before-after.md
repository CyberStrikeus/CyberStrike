# inject_probe: Before vs After (R0–R6)

## Scenario: Advanced multi-class probe on a WAF-protected target

Agent targets `POST /api/v1/search?q=laptop&sort=price` with form body `filter=electronics&page=1`.
Vuln classes: `["xss", "sqli", "hpp"]`

---

## BEFORE (monolith, pre-R0)

### What the agent does:
```
Agent → inject_probe(request_id: "req_abc", vuln_type: ["xss", "sqli"])
```
(hpp didn't exist)

### What happens internally:
1. Probe calls raw `fetch()` directly — **bypasses governed transport**
   - No circuit breaker, no global budget tracking
   - If target is slow, probe hangs for 15s×120 sends = 30 min worst case
2. WAF blocks 80% of sqli payloads with 403
   - Probe burns all 120 sends anyway — no backoff, no skip
   - First 40 sends: sqli error payloads (all blocked)
   - Next 40 sends: sqli boolean pairs (all blocked)
   - Last 40 sends: xss tags/weapons (many blocked)
   - **Budget wasted on blocked points**
3. Probe returns observations to agent:
   ```json
   {
     "results": [
       { "class": "sqli", "observations": [{ "blocked": true, "block_signal": "HTTP 403" }] },
       { "class": "xss",  "observations": [{ "surviving_tags": ["img"], "weaponized": [] }] }
     ],
     "sends": { "used": 120, "cap": 120, "truncated": true }
   }
   ```
4. **What's LOST:**
   - The 3 sqli payloads that DID get through triggered SQL error pages with stack traces
     → These responses are **discarded**. The signal fabric never sees them.
   - The xss nonces injected at `q=` are **not registered** as canaries
     → If `<svg data-p=m1a2b3c4d5>` gets stored and renders on `/admin`, nobody detects it
   - No hpp data → agent doesn't know if the server processes first or last duplicate param
   - Agent must now manually call `http_replay` for every lead, with no shared context

### Agent's next steps (manual, slow):
```
Agent → http_replay: Send "' AND '1'='1" to q= (confirm sqli)
Agent → http_replay: Send "' AND '1'='2" to q= (boolean diff)
Agent → http_replay: Send "<img src=x onerror=alert(1)>" to q= (confirm xss)
Agent → http_replay: Send same payloads to sort= (repeat for other params)
Agent → http_replay: Send same payloads to filter= (repeat for form params)
... (15+ individual http_replay calls, each requiring agent reasoning)
```

---

## AFTER (R0–R6 refactored)

### What the agent does:
```
Agent → inject_probe(request_id: "req_abc", vuln_type: ["xss", "sqli", "hpp"])
```

### What happens internally:

#### Transport (R1): Governed path
```
inject_probe → ReplaySender → governedSend() → BackendFetch.send()
                                    ↓
                          CircuitBreaker + GlobalBudget
                          (same path as http_replay)
```

#### Adaptive backoff (R5): WAF-aware
```
Send #1:  sqli payload "'"        → 403 blocked  → delay escalates 0→500ms
Send #2:  sqli payload '"'        → 403 blocked  → consecutive=2, delay=500ms
Send #3:  sqli payload '`'        → 403 blocked  → consecutive=3 → SKIP THIS POINT
          → moves to next point (sort=) immediately
Send #4:  sqli payload "'" @sort= → 200 OK       → recordSuccess, consecutive=0
Send #5:  sqli payload '"' @sort= → 200 OK + SQL error in body!
          ...
```
- First block: delay → 500ms (give WAF time)
- 3 consecutive blocks at one point: skip remaining payloads for that point
- 5 total blocks: delay → 2000ms
- **Result: 40 sends saved**, budget preserved for points that aren't blocked

#### Signal write-back (R4): Every response scanned
```
Each send → response → scanProbeResponse() → 13 passive detectors + canary.scan()
                                                      ↓
                                              SqlErrorDetector: "MySQL syntax error near..."
                                              FullPathDisclosureDetector: "/var/www/api/search.php"
                                              ServerBannerDetector: "X-Powered-By: PHP/7.4"
                                                      ↓
                                              SignalStore.record() → orchestrator sees these
                                                      ↓
                                              WebRetest.enqueue() → specialist agent notified
```
- SQL errors triggered by sqli payloads → **automatically surfaced** to orchestrator
- Path disclosures → **automatically detected**
- These signals appear in `web-get-session-context` — every agent sees them

#### Canary registration (R3): Cross-response detection
```
Nonce m1a2b3 injected at q= → CanaryRegistry.register({
  token: "m1a2b3",
  kind: "reflect",
  originRequestId: "req_abc",
  endpoint: "/api/v1/search",
  field: "query:q",
  vulnClass: "xss"
})
```
- Later, when crawler captures `/admin/dashboard`:
  ```
  scanCapturedResponse() → canary.scan(body) → "m1a2b3" found!
  → Signal: stored_reflection { originField: "query:q", detectedAt: "/admin/dashboard" }
  → This is stored XSS evidence — the probe's payload traveled from /search to /admin
  ```

#### HPP detection (R5): Parser behavior revealed
```
Phase 1: Baseline   ?q=m9f8e7   → 200, body contains m9f8e7
Phase 2: Append     ?q=1&q=mABC → 200, body contains mABC  → append_reflected=true
Phase 3: Prepend    ?q=mDEF&q=1 → 200, body NOT contains mDEF → prepend_reflected=false
Result: parser_behavior = "last-wins"
```

### Tool output to agent:
```json
{
  "leads": [
    "sqli @ query:sort: payload(s) ['\"'] tripped a sqli error signature — investigate",
    "sqli @ query:sort: boolean-differential on [' AND '1'='1 vs ' AND '1'='2 {bytes,true≈base,false≠base}]",
    "xss @ query:q: tag(s) [img, svg] reflected un-encoded — weaponize one and confirm",
    "hpp @ query:q: parser behavior = last-wins — fire injection payloads at the duplicate position"
  ],
  "block_signals": [
    "sqli @ query:q: HTTP 403",
    "sqli @ form_field:filter: HTTP 403"
  ],
  "backoff": {
    "delay_ms": 500,
    "total_blocks": 4,
    "escalations": ["delay→500ms after first block"]
  },
  "sends": { "used": 82, "cap": 120, "truncated": false }
}
```

### What's different for the agent:

| Aspect | Before | After |
|--------|--------|-------|
| **Transport** | Raw fetch(), no circuit breaker | governedSend() — same as http_replay |
| **Budget waste** | 120/120 sends burned on WAF-blocked points | 82/120 — backoff saved 38 sends |
| **SQL errors** | Observed but discarded | Auto-surfaced to signal fabric + orchestrator |
| **Stored XSS** | Invisible (nonces not registered) | Auto-detected via canary cross-correlation |
| **Parser behavior** | No HPP capability | first-wins/last-wins/both detected |
| **WAF handling** | Ignores blocks, wastes budget | Adaptive: 500ms→skip-point→2000ms |
| **Testability** | Zero tests, untestable raw fetch | 268 tests, mock HttpSender |

### Agent's next steps (focused, informed):
```
Agent → http_replay: UNION SELECT on sort= (sqli confirmed, now exploit)
Agent → http_replay: <img src=x onerror=alert(1)> on q= (xss tag survived, confirm execution)
Agent → http_replay: Duplicate param q=1&q=<sqli> (hpp says last-wins, exploit via duplicate)
```
- Agent knows WHICH points are blocked (skip those, try encoding/evasion)
- Agent knows parser behavior (exploit via HPP last-wins position)
- Agent gets free signal intel (SQL errors, path disclosure, server version) without extra sends
- Stored XSS detection happens automatically in background — no agent effort needed
