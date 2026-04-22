---
name: "AU-6(4)_central-review-and-analysis"
description: "Provide and implement the capability to centrally review and analyze audit records from multiple components within the system."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-6-4
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
  - AU-2
  - AU-12
prerequisites:
  - AU-6
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-12: "Chain with AU-12 for comprehensive security coverage"
---

# AU-6(4) Central Review and Analysis

> **Enhancement of:** AU-6

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Automated mechanisms for centralized reviews and analyses include Security Information and Event Management products.

## What to Check

- [ ] Verify AU-6(4) Central Review and Analysis is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-6(4)
- [ ] Verify enhancement builds upon base control AU-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-6(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide and implement the capability to centrally review and analyze audit records from multiple components within the system.

### Implementation Guidance

Automated mechanisms for centralized reviews and analyses include Security Information and Event Management products.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-6(4) Central Review and Analysis not implemented | Medium | Audit and Accountability |
| AU-6(4) partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-6(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-6.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-12) reviewed
