---
name: "IA-2(10)_single-sign-on"
description: "Provide a single sign-on capability for [organization-defined]."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-2-10
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
chains_with: []
prerequisites:
  - IA-2
severity_boost: {}
---

# IA-2(10) Single Sign-on

> **Enhancement of:** IA-2

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Single sign-on enables users to log in once and gain access to multiple system resources. Organizations consider the operational efficiencies provided by single sign-on capabilities with the risk introduced by allowing access to multiple systems via a single authentication event. Single sign-on can present opportunities to improve system security, for example by providing the ability to add multi-factor authentication for applications and systems (existing and new) that may not be able to natively support multi-factor authentication.

## What to Check

- [ ] Verify IA-2(10) Single Sign-on is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-2(10)
- [ ] Verify enhancement builds upon base control IA-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-2(10) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                        | Usage                      |
| --------------- | ------------------------------ | -------------------------- |
| cloud-audit-mcp | Check authentication settings  | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test authentication mechanisms | `browser_auth_test`        |

## Remediation Guide

### Control Statement

Provide a single sign-on capability for [organization-defined].

### Implementation Guidance

Single sign-on enables users to log in once and gain access to multiple system resources. Organizations consider the operational efficiencies provided by single sign-on capabilities with the risk introduced by allowing access to multiple systems via a single authentication event. Single sign-on can present opportunities to improve system security, for example by providing the ability to add multi-factor authentication for applications and systems (existing and new) that may not be able to natively support multi-factor authentication.

## Risk Assessment

| Finding                                 | Severity | Impact                                       |
| --------------------------------------- | -------- | -------------------------------------------- |
| IA-2(10) Single Sign-on not implemented | High     | Identification and Authentication            |
| IA-2(10) partially implemented          | Medium   | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-287 | Improper Authentication |

## References

- [NIST SP 800-53 Rev 5 - IA-2(10)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-2.10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
