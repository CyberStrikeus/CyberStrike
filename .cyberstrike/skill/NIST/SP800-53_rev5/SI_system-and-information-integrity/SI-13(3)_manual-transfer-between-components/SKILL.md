---
name: "SI-13(3)_manual-transfer-between-components"
description: "Manually initiate transfers between active and standby system components when the use of the active component reaches [organization-defined] of the me"
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-13-3
  - si
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  - SI-13
severity_boost: {}
---

# SI-13(3) Manual Transfer Between Components

> **Enhancement of:** SI-13

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

For example, if the MTTF for a system component is 100 days and the MTTF percentage defined by the organization is 90 percent, the manual transfer would occur after 90 days.

## What to Check

- [ ] Verify SI-13(3) Manual Transfer Between Components is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-13(3)
- [ ] Verify enhancement builds upon base control SI-13

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-13(3) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check integrity monitoring | `cloud_audit_monitoring` |
| AWS CLI | Review GuardDuty/Inspector | `aws guardduty list-detectors` |

## Remediation Guide

### Control Statement

Manually initiate transfers between active and standby system components when the use of the active component reaches [organization-defined] of the mean time to failure.

### Implementation Guidance

For example, if the MTTF for a system component is 100 days and the MTTF percentage defined by the organization is 90 percent, the manual transfer would occur after 90 days.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SI-13(3) Manual Transfer Between Components not implemented | High | System and Information Integrity |
| SI-13(3) partially implemented | Medium | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-53 Rev 5 - SI-13(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-13.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
