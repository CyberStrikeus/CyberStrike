---
name: "AT-2(1)_practical-exercises"
description: "Provide practical exercises in literacy training that simulate events and incidents."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-2-1
  - at
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CA-2
  - CA-7
  - CP-4
  - IR-3
prerequisites:
  - AT-2
severity_boost:
  CA-2: "Chain with CA-2 for comprehensive security coverage"
  CA-7: "Chain with CA-7 for comprehensive security coverage"
  CP-4: "Chain with CP-4 for comprehensive security coverage"
---

# AT-2(1) Practical Exercises

> **Enhancement of:** AT-2

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Practical exercises include no-notice social engineering attempts to collect information, gain unauthorized access, or simulate the adverse impact of opening malicious email attachments or invoking, via spear phishing attacks, malicious web links.

## What to Check

- [ ] Verify AT-2(1) Practical Exercises is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-2(1)
- [ ] Verify enhancement builds upon base control AT-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-2(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide practical exercises in literacy training that simulate events and incidents.

### Implementation Guidance

Practical exercises include no-notice social engineering attempts to collect information, gain unauthorized access, or simulate the adverse impact of opening malicious email attachments or invoking, via spear phishing attacks, malicious web links.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AT-2(1) Practical Exercises not implemented | Medium | Awareness and Training |
| AT-2(1) partially implemented | Low | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-2(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-2.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-2, CA-7, CP-4, IR-3) reviewed
