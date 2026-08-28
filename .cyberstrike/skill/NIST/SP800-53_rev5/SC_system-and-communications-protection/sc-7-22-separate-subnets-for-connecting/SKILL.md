---
name: "SC-7(22)_separate-subnets-for-connecting-to-different-security-domain"
description: "Implement separate network addresses to connect to systems in different security domains."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-7-22
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
chains_with: []
prerequisites:
  - SC-7
severity_boost: {}
---

# SC-7(22) Separate Subnets for Connecting to Different Security Domains

> **Enhancement of:** SC-7

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

The decomposition of systems into subnetworks (i.e., subnets) helps to provide the appropriate level of protection for network connections to different security domains that contain information with different security categories or classification levels.

## What to Check

- [ ] Verify SC-7(22) Separate Subnets for Connecting to Different Security Domains is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-7(22)
- [ ] Verify enhancement builds upon base control SC-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-7(22) implementation details. Verify the organization has documented how this control is satisfied.

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

Implement separate network addresses to connect to systems in different security domains.

### Implementation Guidance

The decomposition of systems into subnetworks (i.e., subnets) helps to provide the appropriate level of protection for network connections to different security domains that contain information with different security categories or classification levels.

## Risk Assessment

| Finding                                                                                | Severity | Impact                                          |
| -------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| SC-7(22) Separate Subnets for Connecting to Different Security Domains not implemented | High     | System and Communications Protection            |
| SC-7(22) partially implemented                                                         | Medium   | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-53 Rev 5 - SC-7(22)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-7.22)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
