---
name: "AU-5_response-to-audit-logging-process-failures"
description: "Alert [organization-defined] within [organization-defined] in the event of an audit logging process failure;"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-5
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
  - AU-2
  - AU-4
  - AU-7
  - AU-9
  - AU-11
  - AU-12
  - AU-14
  - SI-4
  - SI-12
prerequisites: []
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-4: "Chain with AU-4 for comprehensive security coverage"
  AU-7: "Chain with AU-7 for comprehensive security coverage"
---

# AU-5 Response to Audit Logging Process Failures

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Audit logging process failures include software and hardware errors, failures in audit log capturing mechanisms, and reaching or exceeding audit log storage capacity. Organization-defined actions include overwriting oldest audit records, shutting down the system, and stopping the generation of audit records. Organizations may choose to define additional actions for audit logging process failures based on the type of failure, the location of the failure, the severity of the failure, or a combination of such factors. When the audit logging process failure is related to storage, the response is carried out for the audit log storage repository (i.e., the distinct system component where the audit logs are stored), the system on which the audit logs reside, the total audit log storage capacity of the organization (i.e., all audit log storage repositories combined), or all three. Organizations may decide to take no additional actions after alerting designated roles or personnel.

## What to Check

- [ ] Verify AU-5 Response to Audit Logging Process Failures is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Alert [organization-defined] within [organization-defined] in the event of an audit logging process failure; and
Take the following additional actions: [organization-defined].

### Implementation Guidance

Audit logging process failures include software and hardware errors, failures in audit log capturing mechanisms, and reaching or exceeding audit log storage capacity. Organization-defined actions include overwriting oldest audit records, shutting down the system, and stopping the generation of audit records. Organizations may choose to define additional actions for audit logging process failures based on the type of failure, the location of the failure, the severity of the failure, or a combination of such factors. When the audit logging process failure is related to storage, the response is carried out for the audit log storage repository (i.e., the distinct system component where the audit logs are stored), the system on which the audit logs reside, the total audit log storage capacity of the organization (i.e., all audit log storage repositories combined), or all three. Organizations may decide to take no additional actions after alerting designated roles or personnel.

## Risk Assessment

| Finding                                                         | Severity | Impact                              |
| --------------------------------------------------------------- | -------- | ----------------------------------- |
| AU-5 Response to Audit Logging Process Failures not implemented | Medium   | Audit and Accountability            |
| AU-5 partially implemented                                      | Low      | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-53 Rev 5 - AU-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-4, AU-7, AU-9, AU-11) reviewed
