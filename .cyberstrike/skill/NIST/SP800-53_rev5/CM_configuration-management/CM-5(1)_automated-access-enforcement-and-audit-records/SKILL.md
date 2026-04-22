---
name: "CM-5(1)_automated-access-enforcement-and-audit-records"
description: "Enforce access restrictions using [organization-defined] ;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-5-1
  - cm
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  - AU-2
  - AU-6
  - AU-7
  - AU-12
  - CM-6
  - CM-11
  - SI-12
prerequisites:
  - CM-5
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-7: "Chain with AU-7 for comprehensive security coverage"
---

# CM-5(1) Automated Access Enforcement and Audit Records

> **Enhancement of:** CM-5

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Organizations log system accesses associated with applying configuration changes to ensure that configuration change control is implemented and to support after-the-fact actions should organizations discover any unauthorized changes.

## What to Check

- [ ] Verify CM-5(1) Automated Access Enforcement and Audit Records is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-5(1)
- [ ] Verify enhancement builds upon base control CM-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-5(1) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check configuration baselines | `cloud_audit_config` |
| AWS CLI | Review Config rules | `aws configservice describe-config-rules` |

## Remediation Guide

### Control Statement

Enforce access restrictions using [organization-defined] ; and
Automatically generate audit records of the enforcement actions.

### Implementation Guidance

Organizations log system accesses associated with applying configuration changes to ensure that configuration change control is implemented and to support after-the-fact actions should organizations discover any unauthorized changes.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-5(1) Automated Access Enforcement and Audit Records not implemented | Medium | Configuration Management |
| CM-5(1) partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-5(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-5.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-6, AU-7, AU-12, CM-6) reviewed
