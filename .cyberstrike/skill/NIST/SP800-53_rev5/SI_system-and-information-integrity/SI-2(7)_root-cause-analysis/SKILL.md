---
name: "SI-2(7)_root-cause-analysis"
description: "Conduct root cause analysis to identify underlying causes of issues or failures."
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-2-7
  - si
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - AC-1
  - AT-1
  - AU-1
  - CA-1
  - CM-1
  - CP-1
  - IA-1
  - IR-1
  - MA-1
  - MP-1
prerequisites:
  - SI-2
severity_boost:
  AC-1: "Chain with AC-1 for comprehensive security coverage"
  AT-1: "Chain with AT-1 for comprehensive security coverage"
  AU-1: "Chain with AU-1 for comprehensive security coverage"
---

# SI-2(7) Root Cause Analysis

> **Enhancement of:** SI-2

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

Root cause analysis includes a wide range of approaches, tools, and techniques to systematically identify the underlying cause of issues or failures to systems and systems components (hardware, software, and firmware). Organizations consider the severity of the incident to determine what root cause analysis method is used and how quickly implementation of the remediation actions. The root cause analysis includes a timeline, missed warning signs, key decisions, gaps, mitigations, and verification of effectiveness. The actions identified to address the source of the issue are implemented and integrated into applicable organizational policy, procedures, and control implementation.

## What to Check

- [ ] Verify SI-2(7) Root Cause Analysis is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-2(7)
- [ ] Verify enhancement builds upon base control SI-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-2(7) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                    | Usage                          |
| --------------- | -------------------------- | ------------------------------ |
| cloud-audit-mcp | Check integrity monitoring | `cloud_audit_monitoring`       |
| AWS CLI         | Review GuardDuty/Inspector | `aws guardduty list-detectors` |

## Remediation Guide

### Control Statement

Conduct root cause analysis to identify underlying causes of issues or failures.
Develop actions to address the root cause of the issue or failure.
Implement the actions and monitor the implementation for effectiveness.

### Implementation Guidance

Root cause analysis includes a wide range of approaches, tools, and techniques to systematically identify the underlying cause of issues or failures to systems and systems components (hardware, software, and firmware). Organizations consider the severity of the incident to determine what root cause analysis method is used and how quickly implementation of the remediation actions. The root cause analysis includes a timeline, missed warning signs, key decisions, gaps, mitigations, and verification of effectiveness. The actions identified to address the source of the issue are implemented and integrated into applicable organizational policy, procedures, and control implementation.

## Risk Assessment

| Finding                                     | Severity | Impact                                      |
| ------------------------------------------- | -------- | ------------------------------------------- |
| SI-2(7) Root Cause Analysis not implemented | High     | System and Information Integrity            |
| SI-2(7) partially implemented               | Medium   | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-53 Rev 5 - SI-2(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-2.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-1, AT-1, AU-1, CA-1, CM-1) reviewed
