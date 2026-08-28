---
name: "AU-6(6)_correlation-with-physical-monitoring"
description: "Correlate information from audit records with information obtained from monitoring physical access to further enhance the ability to identify suspicio"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-6-6
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
chains_with: []
prerequisites:
  - AU-6
severity_boost: {}
---

# AU-6(6) Correlation with Physical Monitoring

> **Enhancement of:** AU-6

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

The correlation of physical audit record information and the audit records from systems may assist organizations in identifying suspicious behavior or supporting evidence of such behavior. For example, the correlation of an individual’s identity for logical access to certain systems with the additional physical security information that the individual was present at the facility when the logical access occurred may be useful in investigations.

## What to Check

- [ ] Verify AU-6(6) Correlation with Physical Monitoring is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-6(6)
- [ ] Verify enhancement builds upon base control AU-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-6(6) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                      | Usage                            |
| --------------- | ---------------------------- | -------------------------------- |
| cloud-audit-mcp | Check logging configuration  | `cloud_audit_logging`            |
| AWS CLI         | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |

## Remediation Guide

### Control Statement

Correlate information from audit records with information obtained from monitoring physical access to further enhance the ability to identify suspicious, inappropriate, unusual, or malevolent activity.

### Implementation Guidance

The correlation of physical audit record information and the audit records from systems may assist organizations in identifying suspicious behavior or supporting evidence of such behavior. For example, the correlation of an individual’s identity for logical access to certain systems with the additional physical security information that the individual was present at the facility when the logical access occurred may be useful in investigations.

## Risk Assessment

| Finding                                                      | Severity | Impact                              |
| ------------------------------------------------------------ | -------- | ----------------------------------- |
| AU-6(6) Correlation with Physical Monitoring not implemented | Medium   | Audit and Accountability            |
| AU-6(6) partially implemented                                | Low      | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-53 Rev 5 - AU-6(6)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-6.6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
