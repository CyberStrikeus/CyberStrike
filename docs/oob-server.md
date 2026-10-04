# OOB Interaction Server (#85)

**Status:** built (2026-10-04) — DNS + HTTP capture, token correlation, subagent tools.

A self-hosted interactsh/Burp-Collaborator-style server so subagents can confirm **blind** vulnerabilities
— blind SSRF, blind command injection / RCE, blind XXE, OOB SQLi/SSTI, and DNS-exfil channels. A subagent
mints a unique host, injects it into the target, then polls: a captured DNS or HTTP callback is PROOF the
target reached us (the blind vuln fired).

## How it works

```
subagent: oob_generate → <token>.<domain>        (e.g. 13f4…822.oob.cyberstrike.io)
subagent: inject it     → http://<token>.<domain>/  ·  nslookup <token>.<domain>  ·  SYSTEM "http://<token>.<domain>/e"
target   → resolves / fetches <token>.<domain>   → the OOB server captures a DNS/HTTP hit under <token>
subagent: oob_check {token} → interactions ⇒ CONFIRMED (protocol + source IP + timestamp as evidence)
```

- **DNS** (UDP :53): logs every query to `*.<domain>` (catches blind DNS-only callbacks) and answers A
  with the server's public IP, so an HTTP follow-up (the common second stage) also reaches us.
- **HTTP** (:80): logs every request to `*.<domain>` (method, path, headers, source IP).
- **Correlation:** keyed by the token — the subdomain label immediately left of the base domain, so both
  `<token>.<domain>` and `prefix.<token>.<domain>` (targets that prepend labels) correlate.

## Deploy (operator — the one-time DNS setup)

The server must run on a **public host** and own a delegated domain:

1. Pick a base domain, e.g. `oob.cyberstrike.io`.
2. At your DNS provider, delegate it to this host:
   - `oob.cyberstrike.io.  NS  ns1.oob.cyberstrike.io.`
   - `ns1.oob.cyberstrike.io.  A  <PUBLIC_IP>`   (glue)
3. On the host:
   ```
   export CYBERSTRIKE_OOB_DOMAIN=oob.cyberstrike.io
   export CYBERSTRIKE_OOB_IP=<PUBLIC_IP>          # returned in DNS A answers
   # ports default to DNS :53, HTTP :80, management API :8053 (internal)
   cyberstrike oob
   ```
   `:53`/`:80` are privileged — run with the right capability (e.g. `setcap`), or map high ports
   (`CYBERSTRIKE_OOB_DNS_PORT` / `_HTTP_PORT`) behind a forwarder.
4. Verify: `nslookup test.oob.cyberstrike.io <PUBLIC_IP>` and `curl http://test.oob.cyberstrike.io/` should
   both show up in the server log.

## Wire the agent backend to it

The subagent tools read captured interactions either from the **in-process** store (OOB server and
backend are one process) or a **remote** OOB server's management API:

```
export CYBERSTRIKE_OOB_DOMAIN=oob.cyberstrike.io           # so oob_generate mints the right host
export CYBERSTRIKE_OOB_API=http://<oob-host-internal>:8053 # backend polls GET /i/:token here
```

Keep the management API (`:8053`, `GET /i/:token`) internal/loopback — never public.

## Tools (available to every vuln specialist + the escalation hunter)

- `oob_generate` → mints `<token>.<domain>` to inject, returns the token.
- `oob_check {token}` → the DNS/HTTP interactions captured for it; ≥1 = confirmed.

## Config

| Env | Default | Purpose |
|---|---|---|
| `CYBERSTRIKE_OOB_DOMAIN` | — (required) | the delegated base domain |
| `CYBERSTRIKE_OOB_IP` | `127.0.0.1` | IP returned in DNS A answers (the server's public IP) |
| `CYBERSTRIKE_OOB_DNS_PORT` | `53` | DNS listener |
| `CYBERSTRIKE_OOB_HTTP_PORT` | `80` | HTTP listener |
| `CYBERSTRIKE_OOB_API_PORT` | `8053` | management API (0 disables) |
| `CYBERSTRIKE_OOB_API` | — | backend: remote OOB server API URL (unset = read in-process store) |

## Follow-ups

- HTTPS listener (:443) + a wildcard cert for `*.<domain>` (targets that only do https callbacks).
- SMTP capture (OOB email channels).
- Persist interactions (currently in-memory, bounded) if long retention is needed.
- Per-session scoping / auth on the management API.
