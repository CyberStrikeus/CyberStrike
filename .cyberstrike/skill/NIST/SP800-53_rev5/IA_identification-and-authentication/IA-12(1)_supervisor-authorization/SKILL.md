---
name: "IA-12(1)_supervisor-authorization"
description: "Require that the registration process to receive an account for logical access includes supervisor or sponsor authorization."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-12-1
  - ia
  - enhancement
tech_stack:
  - aws
  - azure
  - active-directory
  - linux
  - windows
cwe_ids:
  - CWE-287
chains_with:
  []
prerequisites:
  - IA-12
severity_boost: {}
---

# IA-12(1) Supervisor Authorization

> **Enhancement of:** IA-12

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Including supervisor or sponsor authorization as part of the registration process provides an additional level of scrutiny to ensure that the user’s management chain is aware of the account, the account is essential to carry out organizational missions and functions, and the user’s privileges are appropriate for the anticipated responsibilities and authorities within the organization.

## What to Check

- [ ] Verify IA-12(1) Supervisor Authorization is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-12(1)
- [ ] Verify enhancement builds upon base control IA-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-12(1) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check authentication settings | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test authentication mechanisms | `browser_auth_test` |

## Remediation Guide

### Control Statement

Require that the registration process to receive an account for logical access includes supervisor or sponsor authorization.

### Implementation Guidance

Including supervisor or sponsor authorization as part of the registration process provides an additional level of scrutiny to ensure that the user’s management chain is aware of the account, the account is essential to carry out organizational missions and functions, and the user’s privileges are appropriate for the anticipated responsibilities and authorities within the organization.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IA-12(1) Supervisor Authorization not implemented | High | Identification and Authentication |
| IA-12(1) partially implemented | Medium | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-53 Rev 5 - IA-12(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-12.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
