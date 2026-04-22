---
name: "Access Restrictions for Change (03.04.05)_access-restrictions-for-change"
description: "Access Restrictions for Change"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - access restrictions for change (03-04-05)
  - family-03.04
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Access Restrictions for Change (03.04.05) Access Restrictions for Change

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Access Restrictions for Change

## What to Check

- [ ] Verify Access Restrictions for Change (03.04.05) Access Restrictions for Change is implemented for CUI systems
- [ ] Review SSP documentation for Access Restrictions for Change (03.04.05)
- [ ] Validate CMMC Level 2 assessment objective for Access Restrictions for Change (03.04.05)
- [ ] Confirm POA&M addresses any gaps for Access Restrictions for Change (03.04.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Access Restrictions for Change (03.04.05) implementation description and responsible parties.

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

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools |
| Manual Review | SSP and POA&M review | Documentation analysis |

## Remediation Guide

### Requirement Statement

Implement Access Restrictions for Change per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Changes to the hardware, software, or firmware components of the system or the operational procedures related to the system can have potentially significant effects on the security of the system. Therefore, organizations permit only qualified and authorized individuals to access the system for the purpose of initiating changes. Access restrictions include physical and logical access controls, software libraries, workflow automation, media libraries, abstract layers (i.e., changes implemented into external interfaces rather than directly into the system), and change windows (i.e., changes occur only during specified times).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Access Restrictions for Change (03.04.05) Access Restrictions for Change not implemented | Medium | CUI Protection - Configuration Management |
| Access Restrictions for Change (03.04.05) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Access Restrictions for Change (03.04.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
