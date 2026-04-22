---
name: "SC-12(3)_asymmetric-keys"
description: "Produce, control, and distribute asymmetric cryptographic keys using [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-12-3
  - sc
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
  - network
cwe_ids:
  - CWE-311
chains_with:
  []
prerequisites:
  - SC-12
severity_boost: {}
---

# SC-12(3) Asymmetric Keys

> **Enhancement of:** SC-12

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

[SP 800-56A](#20957dbb-6a1e-40a2-b38a-66f67d33ac2e), [SP 800-56B](#0d083d8a-5cc6-46f1-8d79-3081d42bcb75) , and [SP 800-56C](#eef62b16-c796-4554-955c-505824135b8a) provide guidance on cryptographic key establishment schemes and key derivation methods. [SP 800-57-1](#110e26af-4765-49e1-8740-6750f83fcda1), [SP 800-57-2](#e7942589-e267-4a5a-a3d9-f39a7aae81f0) , and [SP 800-57-3](#8306620b-1920-4d73-8b21-12008528595f) provide guidance on cryptographic key management.

## What to Check

- [ ] Verify SC-12(3) Asymmetric Keys is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-12(3)
- [ ] Verify enhancement builds upon base control SC-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-12(3) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check encryption and network controls | `cloud_audit_encryption` |
| nmap | Network scanning | `nmap -sV --script ssl-enum-ciphers` |

## Remediation Guide

### Control Statement

Produce, control, and distribute asymmetric cryptographic keys using [organization-defined].

### Implementation Guidance

[SP 800-56A](#20957dbb-6a1e-40a2-b38a-66f67d33ac2e), [SP 800-56B](#0d083d8a-5cc6-46f1-8d79-3081d42bcb75) , and [SP 800-56C](#eef62b16-c796-4554-955c-505824135b8a) provide guidance on cryptographic key establishment schemes and key derivation methods. [SP 800-57-1](#110e26af-4765-49e1-8740-6750f83fcda1), [SP 800-57-2](#e7942589-e267-4a5a-a3d9-f39a7aae81f0) , and [SP 800-57-3](#8306620b-1920-4d73-8b21-12008528595f) provide guidance on cryptographic key management.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SC-12(3) Asymmetric Keys not implemented | High | System and Communications Protection |
| SC-12(3) partially implemented | Medium | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-53 Rev 5 - SC-12(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-12.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
