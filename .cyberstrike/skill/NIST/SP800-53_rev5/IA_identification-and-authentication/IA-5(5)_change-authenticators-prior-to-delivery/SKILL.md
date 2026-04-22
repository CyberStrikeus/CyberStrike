---
name: "IA-5(5)_change-authenticators-prior-to-delivery"
description: "Require developers and installers of system components to provide unique authenticators or change default authenticators prior to delivery and install"
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-5-5
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
  - IA-5
severity_boost: {}
---

# IA-5(5) Change Authenticators Prior to Delivery

> **Enhancement of:** IA-5

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Changing authenticators prior to the delivery and installation of system components extends the requirement for organizations to change default authenticators upon system installation by requiring developers and/or installers to provide unique authenticators or change default authenticators for system components prior to delivery and/or installation. However, it typically does not apply to developers of commercial off-the-shelf information technology products. Requirements for unique authenticators can be included in acquisition documents prepared by organizations when procuring systems or system components.

## What to Check

- [ ] Verify IA-5(5) Change Authenticators Prior to Delivery is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-5(5)
- [ ] Verify enhancement builds upon base control IA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-5(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Require developers and installers of system components to provide unique authenticators or change default authenticators prior to delivery and installation.

### Implementation Guidance

Changing authenticators prior to the delivery and installation of system components extends the requirement for organizations to change default authenticators upon system installation by requiring developers and/or installers to provide unique authenticators or change default authenticators for system components prior to delivery and/or installation. However, it typically does not apply to developers of commercial off-the-shelf information technology products. Requirements for unique authenticators can be included in acquisition documents prepared by organizations when procuring systems or system components.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IA-5(5) Change Authenticators Prior to Delivery not implemented | High | Identification and Authentication |
| IA-5(5) partially implemented | Medium | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-53 Rev 5 - IA-5(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-5.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
