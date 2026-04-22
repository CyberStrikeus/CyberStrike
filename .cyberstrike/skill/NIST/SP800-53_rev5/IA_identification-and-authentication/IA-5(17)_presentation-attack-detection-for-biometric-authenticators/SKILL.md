---
name: "IA-5(17)_presentation-attack-detection-for-biometric-authenticators"
description: "Employ presentation attack detection mechanisms for biometric-based authentication."
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-5-17
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
  - AC-7
prerequisites:
  - IA-5
severity_boost:
  AC-7: "Chain with AC-7 for comprehensive security coverage"
---

# IA-5(17) Presentation Attack Detection for Biometric Authenticators

> **Enhancement of:** IA-5

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

Biometric characteristics do not constitute secrets. Such characteristics can be obtained by online web accesses, taking a picture of someone with a camera phone to obtain facial images with or without their knowledge, lifting from objects that someone has touched (e.g., a latent fingerprint), or capturing a high-resolution image (e.g., an iris pattern). Presentation attack detection technologies including liveness detection, can mitigate the risk of these types of attacks by making it difficult to produce artifacts intended to defeat the biometric sensor.

## What to Check

- [ ] Verify IA-5(17) Presentation Attack Detection for Biometric Authenticators is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-5(17)
- [ ] Verify enhancement builds upon base control IA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-5(17) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ presentation attack detection mechanisms for biometric-based authentication.

### Implementation Guidance

Biometric characteristics do not constitute secrets. Such characteristics can be obtained by online web accesses, taking a picture of someone with a camera phone to obtain facial images with or without their knowledge, lifting from objects that someone has touched (e.g., a latent fingerprint), or capturing a high-resolution image (e.g., an iris pattern). Presentation attack detection technologies including liveness detection, can mitigate the risk of these types of attacks by making it difficult to produce artifacts intended to defeat the biometric sensor.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IA-5(17) Presentation Attack Detection for Biometric Authenticators not implemented | High | Identification and Authentication |
| IA-5(17) partially implemented | Medium | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-53 Rev 5 - IA-5(17)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-5.17)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-7) reviewed
