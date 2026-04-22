---
name: "SR-3(3)_sub-tier-flow-down"
description: "Ensure that the controls included in the contracts of prime contractors are also included in the contracts of subcontractors."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-3-3
  - sr
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - SR-5
  - SR-8
prerequisites:
  - SR-3
severity_boost:
  SR-5: "Chain with SR-5 for comprehensive security coverage"
  SR-8: "Chain with SR-8 for comprehensive security coverage"
---

# SR-3(3) Sub-tier Flow Down

> **Enhancement of:** SR-3

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

To manage supply chain risk effectively and holistically, it is important that organizations ensure that supply chain risk management controls are included at all tiers in the supply chain. This includes ensuring that Tier 1 (prime) contractors have implemented processes to facilitate the "flow down" of supply chain risk management controls to sub-tier contractors. The controls subject to flow down are identified in [SR-3b](#sr-3_smt.b).

## What to Check

- [ ] Verify SR-3(3) Sub-tier Flow Down is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-3(3)
- [ ] Verify enhancement builds upon base control SR-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-3(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Ensure that the controls included in the contracts of prime contractors are also included in the contracts of subcontractors.

### Implementation Guidance

To manage supply chain risk effectively and holistically, it is important that organizations ensure that supply chain risk management controls are included at all tiers in the supply chain. This includes ensuring that Tier 1 (prime) contractors have implemented processes to facilitate the "flow down" of supply chain risk management controls to sub-tier contractors. The controls subject to flow down are identified in [SR-3b](#sr-3_smt.b).

## Risk Assessment

| Finding                                    | Severity | Impact                                  |
| ------------------------------------------ | -------- | --------------------------------------- |
| SR-3(3) Sub-tier Flow Down not implemented | Medium   | Supply Chain Risk Management            |
| SR-3(3) partially implemented              | Low      | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-3(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-3.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SR-5, SR-8) reviewed
