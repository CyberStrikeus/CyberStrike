---
name: "AU-6(8)_full-text-analysis-of-privileged-commands"
description: "Perform a full text analysis of logged privileged commands in a physically distinct component or subsystem of the system, or other system that is dedi"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-6-8
  - au
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  - AU-3
  - AU-9
  - AU-11
  - AU-12
prerequisites:
  - AU-6
severity_boost:
  AU-3: "Chain with AU-3 for comprehensive security coverage"
  AU-9: "Chain with AU-9 for comprehensive security coverage"
  AU-11: "Chain with AU-11 for comprehensive security coverage"
---

# AU-6(8) Full Text Analysis of Privileged Commands

> **Enhancement of:** AU-6

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Full text analysis of privileged commands requires a distinct environment for the analysis of audit record information related to privileged users without compromising such information on the system where the users have elevated privileges, including the capability to execute privileged commands. Full text analysis refers to analysis that considers the full text of privileged commands (i.e., commands and parameters) as opposed to analysis that considers only the name of the command. Full text analysis includes the use of pattern matching and heuristics.

## What to Check

- [ ] Verify AU-6(8) Full Text Analysis of Privileged Commands is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-6(8)
- [ ] Verify enhancement builds upon base control AU-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-6(8) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check logging configuration | `cloud_audit_logging` |
| AWS CLI | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |

## Remediation Guide

### Control Statement

Perform a full text analysis of logged privileged commands in a physically distinct component or subsystem of the system, or other system that is dedicated to that analysis.

### Implementation Guidance

Full text analysis of privileged commands requires a distinct environment for the analysis of audit record information related to privileged users without compromising such information on the system where the users have elevated privileges, including the capability to execute privileged commands. Full text analysis refers to analysis that considers the full text of privileged commands (i.e., commands and parameters) as opposed to analysis that considers only the name of the command. Full text analysis includes the use of pattern matching and heuristics.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-6(8) Full Text Analysis of Privileged Commands not implemented | Medium | Audit and Accountability |
| AU-6(8) partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-6(8)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-6.8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-3, AU-9, AU-11, AU-12) reviewed
