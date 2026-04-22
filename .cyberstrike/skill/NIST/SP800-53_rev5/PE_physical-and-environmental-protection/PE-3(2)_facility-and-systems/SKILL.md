---
name: "PE-3(2)_facility-and-systems"
description: "Perform security checks [organization-defined] at the physical perimeter of the facility or system for exfiltration of information or removal of syste"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-3-2
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AC-4
  - SC-7
prerequisites:
  - PE-3
severity_boost:
  AC-4: "Chain with AC-4 for comprehensive security coverage"
  SC-7: "Chain with SC-7 for comprehensive security coverage"
---

# PE-3(2) Facility and Systems

> **Enhancement of:** PE-3

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Organizations determine the extent, frequency, and/or randomness of security checks to adequately mitigate risk associated with exfiltration.

## What to Check

- [ ] Verify PE-3(2) Facility and Systems is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-3(2)
- [ ] Verify enhancement builds upon base control PE-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-3(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Perform security checks [organization-defined] at the physical perimeter of the facility or system for exfiltration of information or removal of system components.

### Implementation Guidance

Organizations determine the extent, frequency, and/or randomness of security checks to adequately mitigate risk associated with exfiltration.

## Risk Assessment

| Finding                                      | Severity | Impact                                           |
| -------------------------------------------- | -------- | ------------------------------------------------ |
| PE-3(2) Facility and Systems not implemented | Medium   | Physical and Environmental Protection            |
| PE-3(2) partially implemented                | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-3(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-3.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-4, SC-7) reviewed
