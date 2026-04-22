---
name: "RA-5(8)_review-historic-audit-logs"
description: "Review historic audit logs to determine if a vulnerability identified in a [organization-defined] has been previously exploited within an [organizatio"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ra-5-8
  - ra
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AU-6
  - AU-11
prerequisites:
  - RA-5
severity_boost:
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-11: "Chain with AU-11 for comprehensive security coverage"
---

# RA-5(8) Review Historic Audit Logs

> **Enhancement of:** RA-5

## High-Level Description

**Family:** Risk Assessment (RA)
**Framework:** NIST SP 800-53 Rev 5

Reviewing historic audit logs to determine if a recently detected vulnerability in a system has been previously exploited by an adversary can provide important information for forensic analyses. Such analyses can help identify, for example, the extent of a previous intrusion, the trade craft employed during the attack, organizational information exfiltrated or modified, mission or business capabilities affected, and the duration of the attack.

## What to Check

- [ ] Verify RA-5(8) Review Historic Audit Logs is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for RA-5(8)
- [ ] Verify enhancement builds upon base control RA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for RA-5(8) implementation details. Verify the organization has documented how this control is satisfied.

### Step 2: Validate Implementation

```
# For cloud environments, use cloud-audit-mcp tools
# For on-premises, review system configurations directly

# Example: Check if account management policies exist
grep -r "account.management\|access.control" /etc/security/ 2>/dev/null
```

### Step 3: Test Operating Effectiveness

Verify the control is actively functioning, not just documented. Check logs, configurations, and operational evidence.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Review historic audit logs to determine if a vulnerability identified in a [organization-defined] has been previously exploited within an [organization-defined].

### Implementation Guidance

Reviewing historic audit logs to determine if a recently detected vulnerability in a system has been previously exploited by an adversary can provide important information for forensic analyses. Such analyses can help identify, for example, the extent of a previous intrusion, the trade craft employed during the attack, organizational information exfiltrated or modified, mission or business capabilities affected, and the duration of the attack.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RA-5(8) Review Historic Audit Logs not implemented | Medium | Risk Assessment |
| RA-5(8) partially implemented | Low | Incomplete Risk Assessment |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - RA-5(8)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ra-5.8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-6, AU-11) reviewed
