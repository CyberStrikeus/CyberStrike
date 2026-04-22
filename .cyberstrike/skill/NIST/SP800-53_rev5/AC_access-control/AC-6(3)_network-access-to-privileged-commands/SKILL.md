---
name: "AC-6(3)_network-access-to-privileged-commands"
description: "Authorize network access to [organization-defined] only for [organization-defined] and document the rationale for such access in the security plan for"
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-6-3
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
  - AC-17
  - AC-18
  - AC-19
prerequisites:
  - AC-6
severity_boost:
  AC-17: "Chain with AC-17 for comprehensive security coverage"
  AC-18: "Chain with AC-18 for comprehensive security coverage"
  AC-19: "Chain with AC-19 for comprehensive security coverage"
---

# AC-6(3) Network Access to Privileged Commands

> **Enhancement of:** AC-6

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Network access is any access across a network connection in lieu of local access (i.e., user being physically present at the device).

## What to Check

- [ ] Verify AC-6(3) Network Access to Privileged Commands is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-6(3)
- [ ] Verify enhancement builds upon base control AC-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-6(3) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                                | Usage                      |
| --------------- | -------------------------------------- | -------------------------- |
| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test web application access controls   | `browser_auth_test`        |

## Remediation Guide

### Control Statement

Authorize network access to [organization-defined] only for [organization-defined] and document the rationale for such access in the security plan for the system.

### Implementation Guidance

Network access is any access across a network connection in lieu of local access (i.e., user being physically present at the device).

## Risk Assessment

| Finding                                                       | Severity | Impact                    |
| ------------------------------------------------------------- | -------- | ------------------------- |
| AC-6(3) Network Access to Privileged Commands not implemented | High     | Access Control            |
| AC-6(3) partially implemented                                 | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-6(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-6.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-17, AC-18, AC-19) reviewed
