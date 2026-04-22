---
name: "SI-18(2)_data-tags"
description: "Employ data tags to automate the correction or deletion of personally identifiable information across the information life cycle within organizational"
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-18-2
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
  - AC-3
  - AC-16
  - SC-16
prerequisites:
  - SI-18
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-16: "Chain with AC-16 for comprehensive security coverage"
  SC-16: "Chain with SC-16 for comprehensive security coverage"
---

# SI-18(2) Data Tags

> **Enhancement of:** SI-18

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

Data tagging personally identifiable information includes tags that note processing permissions, authority to process, de-identification, impact level, information life cycle stage, and retention or last updated dates. Employing data tags for personally identifiable information can support the use of automation tools to correct or delete relevant personally identifiable information.

## What to Check

- [ ] Verify SI-18(2) Data Tags is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-18(2)
- [ ] Verify enhancement builds upon base control SI-18

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-18(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ data tags to automate the correction or deletion of personally identifiable information across the information life cycle within organizational systems.

### Implementation Guidance

Data tagging personally identifiable information includes tags that note processing permissions, authority to process, de-identification, impact level, information life cycle stage, and retention or last updated dates. Employing data tags for personally identifiable information can support the use of automation tools to correct or delete relevant personally identifiable information.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SI-18(2) Data Tags not implemented | High | System and Information Integrity |
| SI-18(2) partially implemented | Medium | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-53 Rev 5 - SI-18(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-18.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, AC-16, SC-16) reviewed
