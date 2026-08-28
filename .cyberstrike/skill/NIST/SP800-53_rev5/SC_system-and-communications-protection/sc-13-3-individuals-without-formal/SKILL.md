---
name: "SC-13(3)_individuals-without-formal-access-approvals"
description: "Individuals Without Formal Access Approvals"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-13-3
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
  - SC-13
severity_boost: {}
---

# SC-13(3) Individuals Without Formal Access Approvals

> **Enhancement of:** SC-13

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

No description available.

## What to Check

- [ ] Verify SC-13(3) Individuals Without Formal Access Approvals is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-13(3)
- [ ] Verify enhancement builds upon base control SC-13

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-13(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Refer to NIST SP 800-53 Rev 5 for the full control statement.

### Implementation Guidance

Implement this control per organizational risk assessment and system categorization.

## Risk Assessment

| Finding                                                              | Severity | Impact                                          |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| SC-13(3) Individuals Without Formal Access Approvals not implemented | High     | System and Communications Protection            |
| SC-13(3) partially implemented                                       | Medium   | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-53 Rev 5 - SC-13(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-13.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
