---
name: "AT-3(1)_environmental-controls"
description: "Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of environmental controls."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-3-1
  - at
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - PE-1
  - PE-11
  - PE-13
  - PE-14
  - PE-15
prerequisites:
  - AT-3
severity_boost:
  PE-1: "Chain with PE-1 for comprehensive security coverage"
  PE-11: "Chain with PE-11 for comprehensive security coverage"
  PE-13: "Chain with PE-13 for comprehensive security coverage"
---

# AT-3(1) Environmental Controls

> **Enhancement of:** AT-3

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Environmental controls include fire suppression and detection devices or systems, sprinkler systems, handheld fire extinguishers, fixed fire hoses, smoke detectors, temperature or humidity, heating, ventilation, air conditioning, and power within the facility.

## What to Check

- [ ] Verify AT-3(1) Environmental Controls is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-3(1)
- [ ] Verify enhancement builds upon base control AT-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-3(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of environmental controls.

### Implementation Guidance

Environmental controls include fire suppression and detection devices or systems, sprinkler systems, handheld fire extinguishers, fixed fire hoses, smoke detectors, temperature or humidity, heating, ventilation, air conditioning, and power within the facility.

## Risk Assessment

| Finding                                        | Severity | Impact                            |
| ---------------------------------------------- | -------- | --------------------------------- |
| AT-3(1) Environmental Controls not implemented | Medium   | Awareness and Training            |
| AT-3(1) partially implemented                  | Low      | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-3(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-3.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PE-1, PE-11, PE-13, PE-14, PE-15) reviewed
