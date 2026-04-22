---
name: "SR-10_inspection-of-systems-or-components"
description: "Inspect the following systems or system components [organization-defined] to detect tampering: [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-10
  - sr
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AT-3
  - PM-30
  - SI-4
  - SI-7
  - SR-3
  - SR-4
  - SR-5
  - SR-9
  - SR-11
prerequisites: []
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  PM-30: "Chain with PM-30 for comprehensive security coverage"
  SI-4: "Chain with SI-4 for comprehensive security coverage"
---

# SR-10 Inspection of Systems or Components

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

The inspection of systems or systems components for tamper resistance and detection addresses physical and logical tampering and is applied to systems and system components removed from organization-controlled areas. Indications of a need for inspection include changes in packaging, specifications, factory location, or entity in which the part is purchased, and when individuals return from travel to high-risk locations.

## What to Check

- [ ] Verify SR-10 Inspection of Systems or Components is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-10 implementation details. Verify the organization has documented how this control is satisfied.

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

Inspect the following systems or system components [organization-defined] to detect tampering: [organization-defined].

### Implementation Guidance

The inspection of systems or systems components for tamper resistance and detection addresses physical and logical tampering and is applied to systems and system components removed from organization-controlled areas. Indications of a need for inspection include changes in packaging, specifications, factory location, or entity in which the part is purchased, and when individuals return from travel to high-risk locations.

## Risk Assessment

| Finding                                                   | Severity | Impact                                  |
| --------------------------------------------------------- | -------- | --------------------------------------- |
| SR-10 Inspection of Systems or Components not implemented | Medium   | Supply Chain Risk Management            |
| SR-10 partially implemented                               | Low      | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-10](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3, PM-30, SI-4, SI-7, SR-3) reviewed
