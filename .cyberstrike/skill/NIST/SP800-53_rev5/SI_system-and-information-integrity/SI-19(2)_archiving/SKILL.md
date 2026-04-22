---
name: "SI-19(2)_archiving"
description: "Prohibit archiving of personally identifiable information elements if those elements in a dataset will not be needed after the dataset is archived."
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-19-2
  - si
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with: []
prerequisites:
  - SI-19
severity_boost: {}
---

# SI-19(2) Archiving

> **Enhancement of:** SI-19

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

Datasets can be archived for many reasons. The envisioned purposes for the archived dataset are specified, and if personally identifiable information elements are not required, the elements are not archived. For example, social security numbers may have been collected for record linkage, but the archived dataset may include the required elements from the linked records. In this case, it is not necessary to archive the social security numbers.

## What to Check

- [ ] Verify SI-19(2) Archiving is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-19(2)
- [ ] Verify enhancement builds upon base control SI-19

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-19(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Prohibit archiving of personally identifiable information elements if those elements in a dataset will not be needed after the dataset is archived.

### Implementation Guidance

Datasets can be archived for many reasons. The envisioned purposes for the archived dataset are specified, and if personally identifiable information elements are not required, the elements are not archived. For example, social security numbers may have been collected for record linkage, but the archived dataset may include the required elements from the linked records. In this case, it is not necessary to archive the social security numbers.

## Risk Assessment

| Finding                            | Severity | Impact                                      |
| ---------------------------------- | -------- | ------------------------------------------- |
| SI-19(2) Archiving not implemented | High     | System and Information Integrity            |
| SI-19(2) partially implemented     | Medium   | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-53 Rev 5 - SI-19(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-19.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
