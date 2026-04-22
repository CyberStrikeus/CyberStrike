---
name: "AU-16(2)_sharing-of-audit-information"
description: "Provide cross-organizational audit information to [organization-defined] based on [organization-defined]."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-16-2
  - au
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  - IR-4
  - SI-4
prerequisites:
  - AU-16
severity_boost:
  IR-4: "Chain with IR-4 for comprehensive security coverage"
  SI-4: "Chain with SI-4 for comprehensive security coverage"
---

# AU-16(2) Sharing of Audit Information

> **Enhancement of:** AU-16

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Due to the distributed nature of the audit information, cross-organization sharing of audit information may be essential for effective analysis of the auditing being performed. For example, the audit records of one organization may not provide sufficient information to determine the appropriate or inappropriate use of organizational information resources by individuals in other organizations. In some instances, only individuals’ home organizations have the appropriate knowledge to make such determinations, thus requiring the sharing of audit information among organizations.

## What to Check

- [ ] Verify AU-16(2) Sharing of Audit Information is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-16(2)
- [ ] Verify enhancement builds upon base control AU-16

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-16(2) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check logging configuration | `cloud_audit_logging` |
| AWS CLI | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |

## Remediation Guide

### Control Statement

Provide cross-organizational audit information to [organization-defined] based on [organization-defined].

### Implementation Guidance

Due to the distributed nature of the audit information, cross-organization sharing of audit information may be essential for effective analysis of the auditing being performed. For example, the audit records of one organization may not provide sufficient information to determine the appropriate or inappropriate use of organizational information resources by individuals in other organizations. In some instances, only individuals’ home organizations have the appropriate knowledge to make such determinations, thus requiring the sharing of audit information among organizations.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-16(2) Sharing of Audit Information not implemented | Medium | Audit and Accountability |
| AU-16(2) partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-16(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-16.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IR-4, SI-4) reviewed
