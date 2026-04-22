---
name: "CM-7(4)_unauthorized-software-deny-by-exception"
description: "Identify [organization-defined];"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-7-4
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
  - CM-6
  - CM-8
  - CM-10
  - PL-9
  - PM-5
prerequisites:
  - CM-7
severity_boost:
  CM-6: "Chain with CM-6 for comprehensive security coverage"
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  CM-10: "Chain with CM-10 for comprehensive security coverage"
---

# CM-7(4) Unauthorized Software — Deny-by-exception

> **Enhancement of:** CM-7

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Unauthorized software programs can be limited to specific versions or from a specific source. The concept of prohibiting the execution of unauthorized software may also be applied to user actions, system ports and protocols, IP addresses/ranges, websites, and MAC addresses.

## What to Check

- [ ] Verify CM-7(4) Unauthorized Software — Deny-by-exception is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-7(4)
- [ ] Verify enhancement builds upon base control CM-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-7(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Identify [organization-defined];
Employ an allow-all, deny-by-exception policy to prohibit the execution of unauthorized software programs on the system; and
Review and update the list of unauthorized software programs [organization-defined].

### Implementation Guidance

Unauthorized software programs can be limited to specific versions or from a specific source. The concept of prohibiting the execution of unauthorized software may also be applied to user actions, system ports and protocols, IP addresses/ranges, websites, and MAC addresses.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-7(4) Unauthorized Software — Deny-by-exception not implemented | Medium | Configuration Management |
| CM-7(4) partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-7(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-7.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-6, CM-8, CM-10, PL-9, PM-5) reviewed
