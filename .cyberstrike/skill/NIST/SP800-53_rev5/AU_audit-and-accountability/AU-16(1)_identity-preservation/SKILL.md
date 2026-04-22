---
name: "AU-16(1)_identity-preservation"
description: "Preserve the identity of individuals in cross-organizational audit trails."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-16-1
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
  - IA-2
  - IA-4
  - IA-5
  - IA-8
prerequisites:
  - AU-16
severity_boost:
  IA-2: "Chain with IA-2 for comprehensive security coverage"
  IA-4: "Chain with IA-4 for comprehensive security coverage"
  IA-5: "Chain with IA-5 for comprehensive security coverage"
---

# AU-16(1) Identity Preservation

> **Enhancement of:** AU-16

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Identity preservation is applied when there is a need to be able to trace actions that are performed across organizational boundaries to a specific individual.

## What to Check

- [ ] Verify AU-16(1) Identity Preservation is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-16(1)
- [ ] Verify enhancement builds upon base control AU-16

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-16(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Preserve the identity of individuals in cross-organizational audit trails.

### Implementation Guidance

Identity preservation is applied when there is a need to be able to trace actions that are performed across organizational boundaries to a specific individual.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-16(1) Identity Preservation not implemented | Medium | Audit and Accountability |
| AU-16(1) partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-16(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-16.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IA-2, IA-4, IA-5, IA-8) reviewed
