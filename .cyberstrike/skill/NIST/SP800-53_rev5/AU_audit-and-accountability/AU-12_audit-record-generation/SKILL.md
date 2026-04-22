---
name: "AU-12_audit-record-generation"
description: "Provide audit record generation capability for the event types the system is capable of auditing as defined in [AU-2a](#au-2_smt.a) on [organizatio..."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-12
  - au
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  - AC-6
  - AC-17
  - AU-2
  - AU-3
  - AU-4
  - AU-5
  - AU-6
  - AU-7
  - AU-14
  - CM-5
prerequisites:
  []
severity_boost:
  AC-6: "Chain with AC-6 for comprehensive security coverage"
  AC-17: "Chain with AC-17 for comprehensive security coverage"
  AU-2: "Chain with AU-2 for comprehensive security coverage"
---

# AU-12 Audit Record Generation

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Audit records can be generated from many different system components. The event types specified in [AU-2d](#au-2_smt.d) are the event types for which audit logs are to be generated and are a subset of all event types for which the system can generate audit records.

## What to Check

- [ ] Verify AU-12 Audit Record Generation is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-12 implementation details. Verify the organization has documented how this control is satisfied.

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

Provide audit record generation capability for the event types the system is capable of auditing as defined in [AU-2a](#au-2_smt.a) on [organization-defined];
Allow [organization-defined] to select the event types that are to be logged by specific components of the system; and
Generate audit records for the event types defined in [AU-2c](#au-2_smt.c) that include the audit record content defined in [AU-3](#au-3).

### Implementation Guidance

Audit records can be generated from many different system components. The event types specified in [AU-2d](#au-2_smt.d) are the event types for which audit logs are to be generated and are a subset of all event types for which the system can generate audit records.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-12 Audit Record Generation not implemented | Medium | Audit and Accountability |
| AU-12 partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-12](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-12)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-6, AC-17, AU-2, AU-3, AU-4) reviewed
