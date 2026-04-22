---
name: "Impact Analyses (03.04.04)_impact-analyses"
description: "Analyze changes to the system to determine potential security impacts prior to change implementation."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - impact analyses (03-04-04)
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
chains_with: []
prerequisites: []
severity_boost: {}
---

# Impact Analyses (03.04.04) Impact Analyses

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Analyze changes to the system to determine potential security impacts prior to change implementation.
Verify that the security requirements for the system continue to be satisfied after the system changes have been implemented.

## What to Check

- [ ] Verify Impact Analyses (03.04.04) Impact Analyses is implemented for CUI systems
- [ ] Review SSP documentation for Impact Analyses (03.04.04)
- [ ] Validate CMMC Level 2 assessment objective for Impact Analyses (03.04.04)
- [ ] Confirm POA&M addresses any gaps for Impact Analyses (03.04.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Impact Analyses (03.04.04) implementation description and responsible parties.

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

Analyze changes to the system to determine potential security impacts prior to change implementation.
Verify that the security requirements for the system continue to be satisfied after the system changes have been implemented.

### Supplemental Guidance

Organizational personnel with security responsibilities conduct impact analyses that include reviewing system security plans, policies, and procedures to understand security requirements; reviewing system design documentation and operational procedures to understand how system changes might affect the security state of the system; reviewing the impacts of system changes on supply chain partners with stakeholders; and determining how potential changes to a system create new risks and the ability to mitigate those risks. Impact analyses also include risk assessments to understand the impacts of changes and determine whether additional security requirements are needed. Changes to the system may affect the safeguards and countermeasures previously implemented. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.04.03)03.04.03. Not all changes to the system are configuration controlled.

## Risk Assessment

| Finding                                                    | Severity | Impact                                    |
| ---------------------------------------------------------- | -------- | ----------------------------------------- |
| Impact Analyses (03.04.04) Impact Analyses not implemented | Medium   | CUI Protection - Configuration Management |
| Impact Analyses (03.04.04) partially implemented (POA&M)   | Low      | CMMC certification risk                   |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Impact Analyses (03.04.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
