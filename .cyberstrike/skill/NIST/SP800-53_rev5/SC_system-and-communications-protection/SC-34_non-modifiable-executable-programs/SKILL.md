---
name: "SC-34_non-modifiable-executable-programs"
description: "For [organization-defined] , load and execute: The operating environment from hardware-enforced, read-only media; and The following applications from "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-34
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
  - AC-3
  - SI-7
  - SI-14
prerequisites:
  []
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  SI-7: "Chain with SI-7 for comprehensive security coverage"
  SI-14: "Chain with SI-14 for comprehensive security coverage"
---

# SC-34 Non-modifiable Executable Programs

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

The operating environment for a system contains the code that hosts applications, including operating systems, executives, or virtual machine monitors (i.e., hypervisors). It can also include certain applications that run directly on hardware platforms. Hardware-enforced, read-only media include Compact Disc-Recordable (CD-R) and Digital Versatile Disc-Recordable (DVD-R) disk drives as well as one-time, programmable, read-only memory. The use of non-modifiable storage ensures the integrity of software from the point of creation of the read-only image. The use of reprogrammable, read-only memory can be accepted as read-only media provided that integrity can be adequately protected from the point of initial writing to the insertion of the memory into the system, and there are reliable hardware protections against reprogramming the memory while installed in organizational systems.

## What to Check

- [ ] Verify SC-34 Non-modifiable Executable Programs is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-34

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-34 implementation details. Verify the organization has documented how this control is satisfied.

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

For [organization-defined] , load and execute:
The operating environment from hardware-enforced, read-only media; and
The following applications from hardware-enforced, read-only media: [organization-defined].

### Implementation Guidance

The operating environment for a system contains the code that hosts applications, including operating systems, executives, or virtual machine monitors (i.e., hypervisors). It can also include certain applications that run directly on hardware platforms. Hardware-enforced, read-only media include Compact Disc-Recordable (CD-R) and Digital Versatile Disc-Recordable (DVD-R) disk drives as well as one-time, programmable, read-only memory. The use of non-modifiable storage ensures the integrity of software from the point of creation of the read-only image. The use of reprogrammable, read-only memory can be accepted as read-only media provided that integrity can be adequately protected from the point of initial writing to the insertion of the memory into the system, and there are reliable hardware protections against reprogramming the memory while installed in organizational systems.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SC-34 Non-modifiable Executable Programs not implemented | High | System and Communications Protection |
| SC-34 partially implemented | Medium | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-53 Rev 5 - SC-34](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-34)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, SI-7, SI-14) reviewed
