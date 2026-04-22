---
name: "SC-34(2)_integrity-protection-on-read-only-media"
description: "Protect the integrity of information prior to storage on read-only media and control the media after such information has been recorded onto the media"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-34-2
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
  - CM-3
  - CM-5
  - CM-9
  - MP-2
  - MP-4
  - MP-5
  - SC-28
  - SI-3
prerequisites:
  - SC-34
severity_boost:
  CM-3: "Chain with CM-3 for comprehensive security coverage"
  CM-5: "Chain with CM-5 for comprehensive security coverage"
  CM-9: "Chain with CM-9 for comprehensive security coverage"
---

# SC-34(2) Integrity Protection on Read-only Media

> **Enhancement of:** SC-34

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Controls prevent the substitution of media into systems or the reprogramming of programmable read-only media prior to installation into the systems. Integrity protection controls include a combination of prevention, detection, and response.

## What to Check

- [ ] Verify SC-34(2) Integrity Protection on Read-only Media is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-34(2)
- [ ] Verify enhancement builds upon base control SC-34

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-34(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Protect the integrity of information prior to storage on read-only media and control the media after such information has been recorded onto the media.

### Implementation Guidance

Controls prevent the substitution of media into systems or the reprogramming of programmable read-only media prior to installation into the systems. Integrity protection controls include a combination of prevention, detection, and response.

## Risk Assessment

| Finding                                                          | Severity | Impact                                          |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------- |
| SC-34(2) Integrity Protection on Read-only Media not implemented | High     | System and Communications Protection            |
| SC-34(2) partially implemented                                   | Medium   | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-53 Rev 5 - SC-34(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-34.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-3, CM-5, CM-9, MP-2, MP-4) reviewed
