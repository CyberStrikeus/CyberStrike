---
name: "AU-16_cross-organizational-audit-logging"
description: "Employ [organization-defined] for coordinating [organization-defined] among external organizations when audit information is transmitted across organi"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-16
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
  - AU-3
  - AU-6
  - AU-7
  - CA-3
  - PT-7
prerequisites: []
severity_boost:
  AU-3: "Chain with AU-3 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-7: "Chain with AU-7 for comprehensive security coverage"
---

# AU-16 Cross-organizational Audit Logging

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

When organizations use systems or services of external organizations, the audit logging capability necessitates a coordinated, cross-organization approach. For example, maintaining the identity of individuals who request specific services across organizational boundaries may often be difficult, and doing so may prove to have significant performance and privacy ramifications. Therefore, it is often the case that cross-organizational audit logging simply captures the identity of individuals who issue requests at the initial system, and subsequent systems record that the requests originated from authorized individuals. Organizations consider including processes for coordinating audit information requirements and protection of audit information in information exchange agreements.

## What to Check

- [ ] Verify AU-16 Cross-organizational Audit Logging is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-16

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-16 implementation details. Verify the organization has documented how this control is satisfied.

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

Employ [organization-defined] for coordinating [organization-defined] among external organizations when audit information is transmitted across organizational boundaries.

### Implementation Guidance

When organizations use systems or services of external organizations, the audit logging capability necessitates a coordinated, cross-organization approach. For example, maintaining the identity of individuals who request specific services across organizational boundaries may often be difficult, and doing so may prove to have significant performance and privacy ramifications. Therefore, it is often the case that cross-organizational audit logging simply captures the identity of individuals who issue requests at the initial system, and subsequent systems record that the requests originated from authorized individuals. Organizations consider including processes for coordinating audit information requirements and protection of audit information in information exchange agreements.

## Risk Assessment

| Finding                                                  | Severity | Impact                              |
| -------------------------------------------------------- | -------- | ----------------------------------- |
| AU-16 Cross-organizational Audit Logging not implemented | Medium   | Audit and Accountability            |
| AU-16 partially implemented                              | Low      | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-53 Rev 5 - AU-16](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-16)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-3, AU-6, AU-7, CA-3, PT-7) reviewed
