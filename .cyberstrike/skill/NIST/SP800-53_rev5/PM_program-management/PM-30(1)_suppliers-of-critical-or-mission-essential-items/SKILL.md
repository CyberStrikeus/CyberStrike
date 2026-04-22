---
name: "PM-30(1)_suppliers-of-critical-or-mission-essential-items"
description: "Identify, prioritize, and assess suppliers of critical or mission-essential technologies, products, and services."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-30-1
  - pm
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - RA-3
  - SR-6
prerequisites:
  - PM-30
severity_boost:
  RA-3: "Chain with RA-3 for comprehensive security coverage"
  SR-6: "Chain with SR-6 for comprehensive security coverage"
---

# PM-30(1) Suppliers of Critical or Mission-essential Items

> **Enhancement of:** PM-30

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

The identification and prioritization of suppliers of critical or mission-essential technologies, products, and services is paramount to the mission/business success of organizations. The assessment of suppliers is conducted using supplier reviews (see [SR-6](#sr-6) ) and supply chain risk assessment processes (see [RA-3(1)](#ra-3.1) ). An analysis of supply chain risk can help an organization identify systems or components for which additional supply chain risk mitigations are required.

## What to Check

- [ ] Verify PM-30(1) Suppliers of Critical or Mission-essential Items is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-30(1)
- [ ] Verify enhancement builds upon base control PM-30

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-30(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Identify, prioritize, and assess suppliers of critical or mission-essential technologies, products, and services.

### Implementation Guidance

The identification and prioritization of suppliers of critical or mission-essential technologies, products, and services is paramount to the mission/business success of organizations. The assessment of suppliers is conducted using supplier reviews (see [SR-6](#sr-6) ) and supply chain risk assessment processes (see [RA-3(1)](#ra-3.1) ). An analysis of supply chain risk can help an organization identify systems or components for which additional supply chain risk mitigations are required.

## Risk Assessment

| Finding                                                                   | Severity | Impact                        |
| ------------------------------------------------------------------------- | -------- | ----------------------------- |
| PM-30(1) Suppliers of Critical or Mission-essential Items not implemented | Medium   | Program Management            |
| PM-30(1) partially implemented                                            | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-30(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-30.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (RA-3, SR-6) reviewed
