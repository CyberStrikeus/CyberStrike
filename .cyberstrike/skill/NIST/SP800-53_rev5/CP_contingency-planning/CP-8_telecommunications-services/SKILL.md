---
name: "CP-8_telecommunications-services"
description: "Establish alternate telecommunications services, including necessary agreements to permit the resumption of [organization-defined] for essential missi"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-8
  - cp
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids:
  []
chains_with:
  - CP-2
  - CP-6
  - CP-7
  - CP-11
  - SC-7
prerequisites:
  []
severity_boost:
  CP-2: "Chain with CP-2 for comprehensive security coverage"
  CP-6: "Chain with CP-6 for comprehensive security coverage"
  CP-7: "Chain with CP-7 for comprehensive security coverage"
---

# CP-8 Telecommunications Services

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Telecommunications services (for data and voice) for primary and alternate processing and storage sites are in scope for [CP-8](#cp-8) . Alternate telecommunications services reflect the continuity requirements in contingency plans to maintain essential mission and business functions despite the loss of primary telecommunications services. Organizations may specify different time periods for primary or alternate sites. Alternate telecommunications services include additional organizational or commercial ground-based circuits or lines, network-based approaches to telecommunications, or the use of satellites. Organizations consider factors such as availability, quality of service, and access when entering into alternate telecommunications agreements.

## What to Check

- [ ] Verify CP-8 Telecommunications Services is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-8 implementation details. Verify the organization has documented how this control is satisfied.

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

Establish alternate telecommunications services, including necessary agreements to permit the resumption of [organization-defined] for essential mission and business functions within [organization-defined] when the primary telecommunications capabilities are unavailable at either the primary or alternate processing or storage sites.

### Implementation Guidance

Telecommunications services (for data and voice) for primary and alternate processing and storage sites are in scope for [CP-8](#cp-8) . Alternate telecommunications services reflect the continuity requirements in contingency plans to maintain essential mission and business functions despite the loss of primary telecommunications services. Organizations may specify different time periods for primary or alternate sites. Alternate telecommunications services include additional organizational or commercial ground-based circuits or lines, network-based approaches to telecommunications, or the use of satellites. Organizations consider factors such as availability, quality of service, and access when entering into alternate telecommunications agreements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CP-8 Telecommunications Services not implemented | Medium | Contingency Planning |
| CP-8 partially implemented | Low | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-8](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-2, CP-6, CP-7, CP-11, SC-7) reviewed
