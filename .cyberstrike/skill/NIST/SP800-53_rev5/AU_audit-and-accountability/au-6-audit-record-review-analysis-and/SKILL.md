---
name: "AU-6_audit-record-review-analysis-and-reporting"
description: "Review and analyze system audit records [organization-defined] for indications of [organization-defined] and the potential impact of the inappropri..."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-6
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
  - AC-2
  - AC-3
  - AC-5
  - AC-6
  - AC-7
  - AC-17
  - AU-7
  - AU-16
  - CA-2
  - CA-7
prerequisites: []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-5: "Chain with AC-5 for comprehensive security coverage"
---

# AU-6 Audit Record Review, Analysis, and Reporting

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Audit record review, analysis, and reporting covers information security- and privacy-related logging performed by organizations, including logging that results from the monitoring of account usage, remote access, wireless connectivity, mobile device connection, configuration settings, system component inventory, use of maintenance tools and non-local maintenance, physical access, temperature and humidity, equipment delivery and removal, communications at system interfaces, and use of mobile code or Voice over Internet Protocol (VoIP). Findings can be reported to organizational entities that include the incident response team, help desk, and security or privacy offices. If organizations are prohibited from reviewing and analyzing audit records or unable to conduct such activities, the review or analysis may be carried out by other organizations granted such authority. The frequency, scope, and/or depth of the audit record review, analysis, and reporting may be adjusted to meet organizational needs based on new information received.

## What to Check

- [ ] Verify AU-6 Audit Record Review, Analysis, and Reporting is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-6 implementation details. Verify the organization has documented how this control is satisfied.

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

Review and analyze system audit records [organization-defined] for indications of [organization-defined] and the potential impact of the inappropriate or unusual activity;
Report findings to [organization-defined] ; and
Adjust the level of audit record review, analysis, and reporting within the system when there is a change in risk based on law enforcement information, intelligence information, or other credible sources of information.

### Implementation Guidance

Audit record review, analysis, and reporting covers information security- and privacy-related logging performed by organizations, including logging that results from the monitoring of account usage, remote access, wireless connectivity, mobile device connection, configuration settings, system component inventory, use of maintenance tools and non-local maintenance, physical access, temperature and humidity, equipment delivery and removal, communications at system interfaces, and use of mobile code or Voice over Internet Protocol (VoIP). Findings can be reported to organizational entities that include the incident response team, help desk, and security or privacy offices. If organizations are prohibited from reviewing and analyzing audit records or unable to conduct such activities, the review or analysis may be carried out by other organizations granted such authority. The frequency, scope, and/or depth of the audit record review, analysis, and reporting may be adjusted to meet organizational needs based on new information received.

## Risk Assessment

| Finding                                                           | Severity | Impact                              |
| ----------------------------------------------------------------- | -------- | ----------------------------------- |
| AU-6 Audit Record Review, Analysis, and Reporting not implemented | Medium   | Audit and Accountability            |
| AU-6 partially implemented                                        | Low      | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-53 Rev 5 - AU-6](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-3, AC-5, AC-6, AC-7) reviewed
