---
name: "SR-11(1)_anti-counterfeit-training"
description: "Train [organization-defined] to detect counterfeit system components (including hardware, software, and firmware)."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-11-1
  - sr
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AT-3
prerequisites:
  - SR-11
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
---

# SR-11(1) Anti-counterfeit Training

> **Enhancement of:** SR-11

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

None.

## What to Check

- [ ] Verify SR-11(1) Anti-counterfeit Training is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-11(1)
- [ ] Verify enhancement builds upon base control SR-11

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-11(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Train [organization-defined] to detect counterfeit system components (including hardware, software, and firmware).

### Implementation Guidance

None.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SR-11(1) Anti-counterfeit Training not implemented | Medium | Supply Chain Risk Management |
| SR-11(1) partially implemented | Low | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-11(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-11.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3) reviewed
