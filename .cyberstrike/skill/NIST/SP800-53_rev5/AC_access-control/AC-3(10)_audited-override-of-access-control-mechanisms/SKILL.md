---
name: "AC-3(10)_audited-override-of-access-control-mechanisms"
description: "Employ an audited override of automated access control mechanisms under [organization-defined] by [organization-defined]."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-3-10
  - ac
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - AU-2
  - AU-6
  - AU-10
  - AU-12
  - AU-14
prerequisites:
  - AC-3
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-10: "Chain with AU-10 for comprehensive security coverage"
---

# AC-3(10) Audited Override of Access Control Mechanisms

> **Enhancement of:** AC-3

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

In certain situations, such as when there is a threat to human life or an event that threatens the organization’s ability to carry out critical missions or business functions, an override capability for access control mechanisms may be needed. Override conditions are defined by organizations and used only in those limited circumstances. Audit events are defined in [AU-2](#au-2) . Audit records are generated in [AU-12](#au-12).

## What to Check

- [ ] Verify AC-3(10) Audited Override of Access Control Mechanisms is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-3(10)
- [ ] Verify enhancement builds upon base control AC-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-3(10) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test web application access controls | `browser_auth_test` |

## Remediation Guide

### Control Statement

Employ an audited override of automated access control mechanisms under [organization-defined] by [organization-defined].

### Implementation Guidance

In certain situations, such as when there is a threat to human life or an event that threatens the organization’s ability to carry out critical missions or business functions, an override capability for access control mechanisms may be needed. Override conditions are defined by organizations and used only in those limited circumstances. Audit events are defined in [AU-2](#au-2) . Audit records are generated in [AU-12](#au-12).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AC-3(10) Audited Override of Access Control Mechanisms not implemented | High | Access Control |
| AC-3(10) partially implemented | Medium | Incomplete Access Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-53 Rev 5 - AC-3(10)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-3.10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-6, AU-10, AU-12, AU-14) reviewed
