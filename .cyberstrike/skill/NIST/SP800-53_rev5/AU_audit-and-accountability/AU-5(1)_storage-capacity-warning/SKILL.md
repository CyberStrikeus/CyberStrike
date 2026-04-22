---
name: "AU-5(1)_storage-capacity-warning"
description: "Provide a warning to [organization-defined] within [organization-defined] when allocated audit log storage volume reaches [organization-defined] of re"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-5-1
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
  []
prerequisites:
  - AU-5
severity_boost: {}
---

# AU-5(1) Storage Capacity Warning

> **Enhancement of:** AU-5

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Organizations may have multiple audit log storage repositories distributed across multiple system components with each repository having different storage volume capacities.

## What to Check

- [ ] Verify AU-5(1) Storage Capacity Warning is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-5(1)
- [ ] Verify enhancement builds upon base control AU-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-5(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide a warning to [organization-defined] within [organization-defined] when allocated audit log storage volume reaches [organization-defined] of repository maximum audit log storage capacity.

### Implementation Guidance

Organizations may have multiple audit log storage repositories distributed across multiple system components with each repository having different storage volume capacities.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-5(1) Storage Capacity Warning not implemented | Medium | Audit and Accountability |
| AU-5(1) partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-5(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-5.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
