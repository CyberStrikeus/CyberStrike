---
name: "Separation of Duties (03.01.04)_separation-of-duties"
description: "Identify the duties of individuals requiring separation."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - separation of duties (03-01-04)
  - family-03.01
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# Separation of Duties (03.01.04) Separation of Duties

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Identify the duties of individuals requiring separation.
Define system access authorizations to support separation of duties.

## What to Check

- [ ] Verify Separation of Duties (03.01.04) Separation of Duties is implemented for CUI systems
- [ ] Review SSP documentation for Separation of Duties (03.01.04)
- [ ] Validate CMMC Level 2 assessment objective for Separation of Duties (03.01.04)
- [ ] Confirm POA&M addresses any gaps for Separation of Duties (03.01.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Separation of Duties (03.01.04) implementation description and responsible parties.

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

Identify the duties of individuals requiring separation.
Define system access authorizations to support separation of duties.

### Supplemental Guidance

Separation of duties addresses the potential for abuse of authorized privileges and reduces the risk of malevolent activity without collusion. Separation of duties includes dividing mission functions and support functions among different individuals or roles, conducting system support functions with different individuals or roles (e.g., quality assurance, configuration management, network security, system management, assessments, and programming), and ensuring that personnel who administer access control functions do not also administer audit functions. Because separation of duty violations can span systems and application domains, organizations consider the entirety of their systems and system components when developing policies on separation of duties. This requirement is enforced by [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.02) 03.01.02.

## Risk Assessment

| Finding                                                              | Severity | Impact                          |
| -------------------------------------------------------------------- | -------- | ------------------------------- |
| Separation of Duties (03.01.04) Separation of Duties not implemented | High     | CUI Protection - Access Control |
| Separation of Duties (03.01.04) partially implemented (POA&M)        | Medium   | CMMC certification risk         |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Separation of Duties (03.01.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
