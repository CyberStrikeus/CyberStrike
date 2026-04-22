---
name: "SC-12_cryptographic-key-establishment-and-management"
description: "Establish and manage cryptographic keys when cryptography is employed within the system in accordance with the following key management requirements: "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-12
  - sc
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
  - AC-17
  - AU-9
  - AU-10
  - CM-3
  - IA-3
  - IA-7
  - IA-13
  - SA-4
  - SA-8
  - SA-9
prerequisites: []
severity_boost:
  AC-17: "Chain with AC-17 for comprehensive security coverage"
  AU-9: "Chain with AU-9 for comprehensive security coverage"
  AU-10: "Chain with AU-10 for comprehensive security coverage"
---

# SC-12 Cryptographic Key Establishment and Management

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Cryptographic key management and establishment can be performed using manual procedures or automated mechanisms with supporting manual procedures. Organizations define key management requirements in accordance with applicable laws, executive orders, directives, regulations, policies, standards, and guidelines and specify appropriate options, parameters, and levels. Organizations manage trust stores to ensure that only approved trust anchors are part of such trust stores. This includes certificates with visibility external to organizational systems and certificates related to the internal operations of systems. [NIST CMVP](#1acdc775-aafb-4d11-9341-dc6a822e9d38) and [NIST CAVP](#84dc1b0c-acb7-4269-84c4-00dbabacd78c) provide additional information on validated cryptographic modules and algorithms that can be used in cryptographic key management and establishment.

## What to Check

- [ ] Verify SC-12 Cryptographic Key Establishment and Management is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-12 implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                               | Usage                                |
| --------------- | ------------------------------------- | ------------------------------------ |
| cloud-audit-mcp | Check encryption and network controls | `cloud_audit_encryption`             |
| nmap            | Network scanning                      | `nmap -sV --script ssl-enum-ciphers` |

## Remediation Guide

### Control Statement

Establish and manage cryptographic keys when cryptography is employed within the system in accordance with the following key management requirements: [organization-defined].

### Implementation Guidance

Cryptographic key management and establishment can be performed using manual procedures or automated mechanisms with supporting manual procedures. Organizations define key management requirements in accordance with applicable laws, executive orders, directives, regulations, policies, standards, and guidelines and specify appropriate options, parameters, and levels. Organizations manage trust stores to ensure that only approved trust anchors are part of such trust stores. This includes certificates with visibility external to organizational systems and certificates related to the internal operations of systems. [NIST CMVP](#1acdc775-aafb-4d11-9341-dc6a822e9d38) and [NIST CAVP](#84dc1b0c-acb7-4269-84c4-00dbabacd78c) provide additional information on validated cryptographic modules and algorithms that can be used in cryptographic key management and establishment.

## Risk Assessment

| Finding                                                              | Severity | Impact                                          |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| SC-12 Cryptographic Key Establishment and Management not implemented | High     | System and Communications Protection            |
| SC-12 partially implemented                                          | Medium   | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-53 Rev 5 - SC-12](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-12)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-17, AU-9, AU-10, CM-3, IA-3) reviewed
