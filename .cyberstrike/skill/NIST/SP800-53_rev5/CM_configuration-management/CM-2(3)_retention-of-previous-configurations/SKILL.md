---
name: "CM-2(3)_retention-of-previous-configurations"
description: "Retain [organization-defined] of previous versions of baseline configurations of the system to support rollback."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-2-3
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
  []
prerequisites:
  - CM-2
severity_boost: {}
---

# CM-2(3) Retention of Previous Configurations

> **Enhancement of:** CM-2

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Retaining previous versions of baseline configurations to support rollback include hardware, software, firmware, configuration files, configuration records, and associated documentation.

## What to Check

- [ ] Verify CM-2(3) Retention of Previous Configurations is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-2(3)
- [ ] Verify enhancement builds upon base control CM-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-2(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Retain [organization-defined] of previous versions of baseline configurations of the system to support rollback.

### Implementation Guidance

Retaining previous versions of baseline configurations to support rollback include hardware, software, firmware, configuration files, configuration records, and associated documentation.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-2(3) Retention of Previous Configurations not implemented | Medium | Configuration Management |
| CM-2(3) partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-2(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-2.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
