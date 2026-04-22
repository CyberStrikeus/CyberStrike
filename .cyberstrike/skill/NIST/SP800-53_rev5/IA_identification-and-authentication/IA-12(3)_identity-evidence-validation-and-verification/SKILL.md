---
name: "IA-12(3)_identity-evidence-validation-and-verification"
description: "Require that the presented identity evidence be validated and verified through [organization-defined]."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-12-3
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
  - IA-12
severity_boost: {}
---

# IA-12(3) Identity Evidence Validation and Verification

> **Enhancement of:** IA-12

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Validation and verification of identity evidence increases the assurance that accounts and identifiers are being established for the correct user and authenticators are being bound to that user. Validation refers to the process of confirming that the evidence is genuine and authentic, and the data contained in the evidence is correct, current, and related to an individual. Verification confirms and establishes a linkage between the claimed identity and the actual existence of the user presenting the evidence. Acceptable methods for validating and verifying identity evidence are consistent with the risks to the systems, roles, and privileges associated with the users account.

## What to Check

- [ ] Verify IA-12(3) Identity Evidence Validation and Verification is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-12(3)
- [ ] Verify enhancement builds upon base control IA-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-12(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Require that the presented identity evidence be validated and verified through [organization-defined].

### Implementation Guidance

Validation and verification of identity evidence increases the assurance that accounts and identifiers are being established for the correct user and authenticators are being bound to that user. Validation refers to the process of confirming that the evidence is genuine and authentic, and the data contained in the evidence is correct, current, and related to an individual. Verification confirms and establishes a linkage between the claimed identity and the actual existence of the user presenting the evidence. Acceptable methods for validating and verifying identity evidence are consistent with the risks to the systems, roles, and privileges associated with the users account.

## Risk Assessment

| Finding                                                                | Severity | Impact                                       |
| ---------------------------------------------------------------------- | -------- | -------------------------------------------- |
| IA-12(3) Identity Evidence Validation and Verification not implemented | High     | Identification and Authentication            |
| IA-12(3) partially implemented                                         | Medium   | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-287 | Improper Authentication |

## References

- [NIST SP 800-53 Rev 5 - IA-12(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-12.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
