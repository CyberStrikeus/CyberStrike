---
name: "SI-7_software-firmware-and-information-integrity"
description: "Employ integrity verification tools to detect unauthorized changes to the following software, firmware, and information: [organization-defined] ;"
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-7
  - si
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - AC-4
  - CM-3
  - CM-7
  - CM-8
  - MA-3
  - MA-4
  - RA-5
  - SA-8
  - SA-9
  - SA-10
prerequisites:
  []
severity_boost:
  AC-4: "Chain with AC-4 for comprehensive security coverage"
  CM-3: "Chain with CM-3 for comprehensive security coverage"
  CM-7: "Chain with CM-7 for comprehensive security coverage"
---

# SI-7 Software, Firmware, and Information Integrity

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

Unauthorized changes to software, firmware, and information can occur due to errors or malicious activity. Software includes operating systems (with key internal components, such as kernels or drivers), middleware, and applications. Firmware interfaces include Unified Extensible Firmware Interface (UEFI) and Basic Input/Output System (BIOS). Information includes personally identifiable information and metadata that contains security and privacy attributes associated with information. Integrity-checking mechanisms—including parity checks, cyclical redundancy checks, cryptographic hashes, and associated tools—can automatically monitor the integrity of systems and hosted applications.

## What to Check

- [ ] Verify SI-7 Software, Firmware, and Information Integrity is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-7 implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check integrity monitoring | `cloud_audit_monitoring` |
| AWS CLI | Review GuardDuty/Inspector | `aws guardduty list-detectors` |

## Remediation Guide

### Control Statement

Employ integrity verification tools to detect unauthorized changes to the following software, firmware, and information: [organization-defined] ; and
Take the following actions when unauthorized changes to the software, firmware, and information are detected: [organization-defined].

### Implementation Guidance

Unauthorized changes to software, firmware, and information can occur due to errors or malicious activity. Software includes operating systems (with key internal components, such as kernels or drivers), middleware, and applications. Firmware interfaces include Unified Extensible Firmware Interface (UEFI) and Basic Input/Output System (BIOS). Information includes personally identifiable information and metadata that contains security and privacy attributes associated with information. Integrity-checking mechanisms—including parity checks, cyclical redundancy checks, cryptographic hashes, and associated tools—can automatically monitor the integrity of systems and hosted applications.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SI-7 Software, Firmware, and Information Integrity not implemented | High | System and Information Integrity |
| SI-7 partially implemented | Medium | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-53 Rev 5 - SI-7](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-4, CM-3, CM-7, CM-8, MA-3) reviewed
