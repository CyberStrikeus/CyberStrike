---
name: "Information Management and Retention (03.14.08)_information-management-and-retention"
description: "Information Management and Retention"
category: "input-validation"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - information management and retention (03-14-08)
  - family-03.14
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# Information Management and Retention (03.14.08) Information Management and Retention

## High-Level Description

**Family:** System and Information Integrity
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Information Management and Retention

## What to Check

- [ ] Verify Information Management and Retention (03.14.08) Information Management and Retention is implemented for CUI systems
- [ ] Review SSP documentation for Information Management and Retention (03.14.08)
- [ ] Validate CMMC Level 2 assessment objective for Information Management and Retention (03.14.08)
- [ ] Confirm POA&M addresses any gaps for Information Management and Retention (03.14.08)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Information Management and Retention (03.14.08) implementation description and responsible parties.

### Step 2: Assess Implementation

```
# Verify security controls protecting CUI
# Check access controls, encryption, monitoring as applicable

# For Linux systems:
ls -la /etc/security/ 2>/dev/null
grep -r "CUI\|controlled" /etc/security/ 2>/dev/null

# For cloud:
# Use cloud-audit-mcp tools to assess posture
```

### Step 3: CMMC Assessment Validation

Verify this requirement passes CMMC Level 2 assessment methodology per SP 800-171A Rev 3.

## Tools

| Tool            | Purpose                      | Usage                  |
| --------------- | ---------------------------- | ---------------------- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools  |
| Manual Review   | SSP and POA&M review         | Documentation analysis |

## Remediation Guide

### Requirement Statement

Implement Information Management and Retention per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Federal agencies consider data retention requirements for nonfederal organizations. Retaining CUI on nonfederal systems after contracts or agreements have concluded increases the attack surface for those systems and the risk of the information being compromised. NARA provides federal policy and guidance on records retention and schedules.

## Risk Assessment

| Finding                                                                                              | Severity | Impact                                            |
| ---------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| Information Management and Retention (03.14.08) Information Management and Retention not implemented | High     | CUI Protection - System and Information Integrity |
| Information Management and Retention (03.14.08) partially implemented (POA&M)                        | Medium   | CMMC certification risk                           |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Information Management and Retention (03.14.08) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
