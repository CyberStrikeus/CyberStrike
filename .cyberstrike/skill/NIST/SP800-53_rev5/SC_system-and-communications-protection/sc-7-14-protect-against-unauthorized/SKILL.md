---
name: "SC-7(14)_protect-against-unauthorized-physical-connections"
description: "Protect against unauthorized physical connections at [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-7-14
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
  - PE-4
  - PE-19
prerequisites:
  - SC-7
severity_boost:
  PE-4: "Chain with PE-4 for comprehensive security coverage"
  PE-19: "Chain with PE-19 for comprehensive security coverage"
---

# SC-7(14) Protect Against Unauthorized Physical Connections

> **Enhancement of:** SC-7

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Systems that operate at different security categories or classification levels may share common physical and environmental controls, since the systems may share space within the same facilities. In practice, it is possible that these separate systems may share common equipment rooms, wiring closets, and cable distribution paths. Protection against unauthorized physical connections can be achieved by using clearly identified and physically separated cable trays, connection frames, and patch panels for each side of managed interfaces with physical access controls that enforce limited authorized access to these items.

## What to Check

- [ ] Verify SC-7(14) Protect Against Unauthorized Physical Connections is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-7(14)
- [ ] Verify enhancement builds upon base control SC-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-7(14) implementation details. Verify the organization has documented how this control is satisfied.

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

Protect against unauthorized physical connections at [organization-defined].

### Implementation Guidance

Systems that operate at different security categories or classification levels may share common physical and environmental controls, since the systems may share space within the same facilities. In practice, it is possible that these separate systems may share common equipment rooms, wiring closets, and cable distribution paths. Protection against unauthorized physical connections can be achieved by using clearly identified and physically separated cable trays, connection frames, and patch panels for each side of managed interfaces with physical access controls that enforce limited authorized access to these items.

## Risk Assessment

| Finding                                                                    | Severity | Impact                                          |
| -------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| SC-7(14) Protect Against Unauthorized Physical Connections not implemented | High     | System and Communications Protection            |
| SC-7(14) partially implemented                                             | Medium   | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-53 Rev 5 - SC-7(14)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-7.14)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PE-4, PE-19) reviewed
