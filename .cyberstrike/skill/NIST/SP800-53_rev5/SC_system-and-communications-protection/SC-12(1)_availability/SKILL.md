---
name: "SC-12(1)_availability"
description: "Maintain availability of information in the event of the loss of cryptographic keys by users."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-12-1
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

# SC-12(1) Availability

> **Enhancement of:** SC-12

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Escrowing of encryption keys is a common practice for ensuring availability in the event of key loss. A forgotten passphrase is an example of losing a cryptographic key.

## What to Check

- [ ] Verify SC-12(1) Availability is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-12(1)
- [ ] Verify enhancement builds upon base control SC-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-12(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Maintain availability of information in the event of the loss of cryptographic keys by users.

### Implementation Guidance

Escrowing of encryption keys is a common practice for ensuring availability in the event of key loss. A forgotten passphrase is an example of losing a cryptographic key.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SC-12(1) Availability not implemented | High | System and Communications Protection |
| SC-12(1) partially implemented | Medium | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-53 Rev 5 - SC-12(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-12.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
