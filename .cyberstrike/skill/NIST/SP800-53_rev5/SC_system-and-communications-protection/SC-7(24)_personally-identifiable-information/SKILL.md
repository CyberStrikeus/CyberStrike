---
name: "SC-7(24)_personally-identifiable-information"
description: "For systems that process personally identifiable information: Apply the following processing rules to data elements of personally identifiable informa"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-7-24
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
  - PT-2
  - SI-15
prerequisites:
  - SC-7
severity_boost:
  PT-2: "Chain with PT-2 for comprehensive security coverage"
  SI-15: "Chain with SI-15 for comprehensive security coverage"
---

# SC-7(24) Personally Identifiable Information

> **Enhancement of:** SC-7

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Managing the processing of personally identifiable information is an important aspect of protecting an individual’s privacy. Applying, monitoring for, and documenting exceptions to processing rules ensure that personally identifiable information is processed only in accordance with established privacy requirements.

## What to Check

- [ ] Verify SC-7(24) Personally Identifiable Information is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-7(24)
- [ ] Verify enhancement builds upon base control SC-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-7(24) implementation details. Verify the organization has documented how this control is satisfied.

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

For systems that process personally identifiable information:
Apply the following processing rules to data elements of personally identifiable information: [organization-defined];
Monitor for permitted processing at the external interfaces to the system and at key internal boundaries within the system;
Document each processing exception; and
Review and remove exceptions that are no longer supported.

### Implementation Guidance

Managing the processing of personally identifiable information is an important aspect of protecting an individual’s privacy. Applying, monitoring for, and documenting exceptions to processing rules ensure that personally identifiable information is processed only in accordance with established privacy requirements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SC-7(24) Personally Identifiable Information not implemented | High | System and Communications Protection |
| SC-7(24) partially implemented | Medium | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-53 Rev 5 - SC-7(24)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-7.24)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PT-2, SI-15) reviewed
