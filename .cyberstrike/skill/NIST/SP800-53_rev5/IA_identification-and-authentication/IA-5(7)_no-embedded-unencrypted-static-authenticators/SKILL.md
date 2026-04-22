---
name: "IA-5(7)_no-embedded-unencrypted-static-authenticators"
description: "Ensure that unencrypted static authenticators are not embedded in applications or other forms of static storage."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-5-7
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

# IA-5(7) No Embedded Unencrypted Static Authenticators

> **Enhancement of:** IA-5

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

In addition to applications, other forms of static storage include access scripts and function keys. Organizations exercise caution when determining whether embedded or stored authenticators are in encrypted or unencrypted form. If authenticators are used in the manner stored, then those representations are considered unencrypted authenticators.

## What to Check

- [ ] Verify IA-5(7) No Embedded Unencrypted Static Authenticators is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-5(7)
- [ ] Verify enhancement builds upon base control IA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-5(7) implementation details. Verify the organization has documented how this control is satisfied.

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

Ensure that unencrypted static authenticators are not embedded in applications or other forms of static storage.

### Implementation Guidance

In addition to applications, other forms of static storage include access scripts and function keys. Organizations exercise caution when determining whether embedded or stored authenticators are in encrypted or unencrypted form. If authenticators are used in the manner stored, then those representations are considered unencrypted authenticators.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IA-5(7) No Embedded Unencrypted Static Authenticators not implemented | High | Identification and Authentication |
| IA-5(7) partially implemented | Medium | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-53 Rev 5 - IA-5(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-5.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
