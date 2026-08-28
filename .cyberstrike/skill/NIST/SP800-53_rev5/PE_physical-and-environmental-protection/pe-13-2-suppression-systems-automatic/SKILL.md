---
name: "PE-13(2)_suppression-systems-automatic-activation-and-notification"
description: "Employ fire suppression systems that activate automatically and notify [organization-defined] and [organization-defined] ;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-13-2
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - PE-13
severity_boost: {}
---

# PE-13(2) Suppression Systems — Automatic Activation and Notification

> **Enhancement of:** PE-13

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Organizations can identify specific personnel, roles, and emergency responders if individuals on the notification list need to have appropriate access authorizations and/or clearances (e.g., to enter to facilities where access is restricted due to the impact level or classification of information within the facility). Notification mechanisms may require independent energy sources to ensure that the notification capability is not adversely affected by the fire.

## What to Check

- [ ] Verify PE-13(2) Suppression Systems — Automatic Activation and Notification is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-13(2)
- [ ] Verify enhancement builds upon base control PE-13

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-13(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ fire suppression systems that activate automatically and notify [organization-defined] and [organization-defined] ; and
Employ an automatic fire suppression capability when the facility is not staffed on a continuous basis.

### Implementation Guidance

Organizations can identify specific personnel, roles, and emergency responders if individuals on the notification list need to have appropriate access authorizations and/or clearances (e.g., to enter to facilities where access is restricted due to the impact level or classification of information within the facility). Notification mechanisms may require independent energy sources to ensure that the notification capability is not adversely affected by the fire.

## Risk Assessment

| Finding                                                                              | Severity | Impact                                           |
| ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------ |
| PE-13(2) Suppression Systems — Automatic Activation and Notification not implemented | Medium   | Physical and Environmental Protection            |
| PE-13(2) partially implemented                                                       | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-13(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-13.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
