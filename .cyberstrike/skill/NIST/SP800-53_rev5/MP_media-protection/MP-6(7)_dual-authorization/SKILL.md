---
name: "MP-6(7)_dual-authorization"
description: "Enforce dual authorization for the sanitization of [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - mp-6-7
  - mp
  - enhancement
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with:
  - AC-3
  - MP-2
prerequisites:
  - MP-6
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  MP-2: "Chain with MP-2 for comprehensive security coverage"
---

# MP-6(7) Dual Authorization

> **Enhancement of:** MP-6

## High-Level Description

**Family:** Media Protection (MP)
**Framework:** NIST SP 800-53 Rev 5

Organizations employ dual authorization to help ensure that system media sanitization cannot occur unless two technically qualified individuals conduct the designated task. Individuals who sanitize system media possess sufficient skills and expertise to determine if the proposed sanitization reflects applicable federal and organizational standards, policies, and procedures. Dual authorization also helps to ensure that sanitization occurs as intended, protecting against errors and false claims of having performed the sanitization actions. Dual authorization may also be known as two-person control. To reduce the risk of collusion, organizations consider rotating dual authorization duties to other individuals.

## What to Check

- [ ] Verify MP-6(7) Dual Authorization is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MP-6(7)
- [ ] Verify enhancement builds upon base control MP-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MP-6(7) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool          | Purpose                           | Usage |
| ------------- | --------------------------------- | ----- |
| Manual Review | Documentation and interview-based | N/A   |

## Remediation Guide

### Control Statement

Enforce dual authorization for the sanitization of [organization-defined].

### Implementation Guidance

Organizations employ dual authorization to help ensure that system media sanitization cannot occur unless two technically qualified individuals conduct the designated task. Individuals who sanitize system media possess sufficient skills and expertise to determine if the proposed sanitization reflects applicable federal and organizational standards, policies, and procedures. Dual authorization also helps to ensure that sanitization occurs as intended, protecting against errors and false claims of having performed the sanitization actions. Dual authorization may also be known as two-person control. To reduce the risk of collusion, organizations consider rotating dual authorization duties to other individuals.

## Risk Assessment

| Finding                                    | Severity | Impact                      |
| ------------------------------------------ | -------- | --------------------------- |
| MP-6(7) Dual Authorization not implemented | Medium   | Media Protection            |
| MP-6(7) partially implemented              | Low      | Incomplete Media Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MP-6(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=mp-6.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, MP-2) reviewed
