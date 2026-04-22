---
name: "IA-12_identity-proofing"
description: "Identity proof users that require accounts for logical access to systems based on appropriate identity assurance level requirements as specified in..."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-12
  - ia
tech_stack:
  - aws
  - azure
  - active-directory
  - linux
  - windows
cwe_ids:
  - CWE-287
chains_with:
  - AC-5
  - IA-1
  - IA-2
  - IA-3
  - IA-4
  - IA-5
  - IA-6
  - IA-8
  - IA-13
prerequisites:
  []
severity_boost:
  AC-5: "Chain with AC-5 for comprehensive security coverage"
  IA-1: "Chain with IA-1 for comprehensive security coverage"
  IA-2: "Chain with IA-2 for comprehensive security coverage"
---

# IA-12 Identity Proofing

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Identity proofing is the process of collecting, validating, and verifying a user’s identity information for the purposes of establishing credentials for accessing a system. Identity proofing is intended to mitigate threats to the registration of users and the establishment of their accounts. Standards and guidelines specifying identity assurance levels for identity proofing include [SP 800-63-3](#737513fa-6758-403f-831d-5ddab5e23cb3) and [SP 800-63A](#9099ed2c-922a-493d-bcb4-d896192243ff) . Organizations may be subject to laws, executive orders, directives, regulations, or policies that address the collection of identity evidence. Organizational personnel consult with the senior agency official for privacy and legal counsel regarding such requirements.

## What to Check

- [ ] Verify IA-12 Identity Proofing is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-12 implementation details. Verify the organization has documented how this control is satisfied.

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

Identity proof users that require accounts for logical access to systems based on appropriate identity assurance level requirements as specified in applicable standards and guidelines;
Resolve user identities to a unique individual; and
Collect, validate, and verify identity evidence.

### Implementation Guidance

Identity proofing is the process of collecting, validating, and verifying a user’s identity information for the purposes of establishing credentials for accessing a system. Identity proofing is intended to mitigate threats to the registration of users and the establishment of their accounts. Standards and guidelines specifying identity assurance levels for identity proofing include [SP 800-63-3](#737513fa-6758-403f-831d-5ddab5e23cb3) and [SP 800-63A](#9099ed2c-922a-493d-bcb4-d896192243ff) . Organizations may be subject to laws, executive orders, directives, regulations, or policies that address the collection of identity evidence. Organizational personnel consult with the senior agency official for privacy and legal counsel regarding such requirements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IA-12 Identity Proofing not implemented | High | Identification and Authentication |
| IA-12 partially implemented | Medium | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-53 Rev 5 - IA-12](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-12)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-5, IA-1, IA-2, IA-3, IA-4) reviewed
