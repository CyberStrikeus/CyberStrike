---
name: "SI-18_personally-identifiable-information-quality-operations"
description: "Check the accuracy, relevance, timeliness, and completeness of personally identifiable information across the information life cycle [organization-..."
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-18
  - si
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - PM-22
  - PM-24
  - PT-2
  - SI-4
prerequisites: []
severity_boost:
  PM-22: "Chain with PM-22 for comprehensive security coverage"
  PM-24: "Chain with PM-24 for comprehensive security coverage"
  PT-2: "Chain with PT-2 for comprehensive security coverage"
---

# SI-18 Personally Identifiable Information Quality Operations

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

Personally identifiable information quality operations include the steps that organizations take to confirm the accuracy and relevance of personally identifiable information throughout the information life cycle. The information life cycle includes the creation, collection, use, processing, storage, maintenance, dissemination, disclosure, and disposal of personally identifiable information. Personally identifiable information quality operations include editing and validating addresses as they are collected or entered into systems using automated address verification look-up application programming interfaces. Checking personally identifiable information quality includes the tracking of updates or changes to data over time, which enables organizations to know how and what personally identifiable information was changed should erroneous information be identified. The measures taken to protect personally identifiable information quality are based on the nature and context of the personally identifiable information, how it is to be used, how it was obtained, and the potential de-identification methods employed. The measures taken to validate the accuracy of personally identifiable information used to make determinations about the rights, benefits, or privileges of individuals covered under federal programs may be more comprehensive than the measures used to validate personally identifiable information used for less sensitive purposes.

## What to Check

- [ ] Verify SI-18 Personally Identifiable Information Quality Operations is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-18

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-18 implementation details. Verify the organization has documented how this control is satisfied.

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

Check the accuracy, relevance, timeliness, and completeness of personally identifiable information across the information life cycle [organization-defined] ; and
Correct or delete inaccurate or outdated personally identifiable information.

### Implementation Guidance

Personally identifiable information quality operations include the steps that organizations take to confirm the accuracy and relevance of personally identifiable information throughout the information life cycle. The information life cycle includes the creation, collection, use, processing, storage, maintenance, dissemination, disclosure, and disposal of personally identifiable information. Personally identifiable information quality operations include editing and validating addresses as they are collected or entered into systems using automated address verification look-up application programming interfaces. Checking personally identifiable information quality includes the tracking of updates or changes to data over time, which enables organizations to know how and what personally identifiable information was changed should erroneous information be identified. The measures taken to protect personally identifiable information quality are based on the nature and context of the personally identifiable information, how it is to be used, how it was obtained, and the potential de-identification methods employed. The measures taken to validate the accuracy of personally identifiable information used to make determinations about the rights, benefits, or privileges of individuals covered under federal programs may be more comprehensive than the measures used to validate personally identifiable information used for less sensitive purposes.

## Risk Assessment

| Finding                                                                      | Severity | Impact                                      |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| SI-18 Personally Identifiable Information Quality Operations not implemented | High     | System and Information Integrity            |
| SI-18 partially implemented                                                  | Medium   | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-53 Rev 5 - SI-18](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-18)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PM-22, PM-24, PT-2, SI-4) reviewed
