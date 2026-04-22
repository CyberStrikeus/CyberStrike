---
name: "SI-19_de-identification"
description: "Remove the following elements of personally identifiable information from datasets: [organization-defined] ;"
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-19
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
  - MP-6
  - PM-22
  - PM-23
  - PM-24
  - RA-2
  - SI-12
prerequisites: []
severity_boost:
  MP-6: "Chain with MP-6 for comprehensive security coverage"
  PM-22: "Chain with PM-22 for comprehensive security coverage"
  PM-23: "Chain with PM-23 for comprehensive security coverage"
---

# SI-19 De-identification

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

De-identification is the general term for the process of removing the association between a set of identifying data and the data subject. Many datasets contain information about individuals that can be used to distinguish or trace an individual’s identity, such as name, social security number, date and place of birth, mother’s maiden name, or biometric records. Datasets may also contain other information that is linked or linkable to an individual, such as medical, educational, financial, and employment information. Personally identifiable information is removed from datasets by trained individuals when such information is not (or no longer) necessary to satisfy the requirements envisioned for the data. For example, if the dataset is only used to produce aggregate statistics, the identifiers that are not needed for producing those statistics are removed. Removing identifiers improves privacy protection since information that is removed cannot be inadvertently disclosed or improperly used. Organizations may be subject to specific de-identification definitions or methods under applicable laws, regulations, or policies. Re-identification is a residual risk with de-identified data. Re-identification attacks can vary, including combining new datasets or other improvements in data analytics. Maintaining awareness of potential attacks and evaluating for the effectiveness of the de-identification over time support the management of this residual risk.

## What to Check

- [ ] Verify SI-19 De-identification is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-19

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-19 implementation details. Verify the organization has documented how this control is satisfied.

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

Remove the following elements of personally identifiable information from datasets: [organization-defined] ; and
Evaluate [organization-defined] for effectiveness of de-identification.

### Implementation Guidance

De-identification is the general term for the process of removing the association between a set of identifying data and the data subject. Many datasets contain information about individuals that can be used to distinguish or trace an individual’s identity, such as name, social security number, date and place of birth, mother’s maiden name, or biometric records. Datasets may also contain other information that is linked or linkable to an individual, such as medical, educational, financial, and employment information. Personally identifiable information is removed from datasets by trained individuals when such information is not (or no longer) necessary to satisfy the requirements envisioned for the data. For example, if the dataset is only used to produce aggregate statistics, the identifiers that are not needed for producing those statistics are removed. Removing identifiers improves privacy protection since information that is removed cannot be inadvertently disclosed or improperly used. Organizations may be subject to specific de-identification definitions or methods under applicable laws, regulations, or policies. Re-identification is a residual risk with de-identified data. Re-identification attacks can vary, including combining new datasets or other improvements in data analytics. Maintaining awareness of potential attacks and evaluating for the effectiveness of the de-identification over time support the management of this residual risk.

## Risk Assessment

| Finding                                 | Severity | Impact                                      |
| --------------------------------------- | -------- | ------------------------------------------- |
| SI-19 De-identification not implemented | High     | System and Information Integrity            |
| SI-19 partially implemented             | Medium   | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-53 Rev 5 - SI-19](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-19)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (MP-6, PM-22, PM-23, PM-24, RA-2) reviewed
