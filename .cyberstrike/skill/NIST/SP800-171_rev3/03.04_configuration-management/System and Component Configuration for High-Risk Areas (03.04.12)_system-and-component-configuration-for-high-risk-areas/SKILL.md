---
name: "System and Component Configuration for High-Risk Areas (03.04.12)_system-and-component-configuration-for-high-risk-areas"
description: "Issue systems or system components with the following configurations to individuals traveling to high-risk locations: [organization-defined]."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - system and component configuration for high-risk areas (03-04-12)
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

# System and Component Configuration for High-Risk Areas (03.04.12) System and Component Configuration for High-Risk Areas

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Issue systems or system components with the following configurations to individuals traveling to high-risk locations: [organization-defined].
Apply the following security requirements to the systems or components when the individuals return from travel: [organization-defined].

## What to Check

- [ ] Verify System and Component Configuration for High-Risk Areas (03.04.12) System and Component Configuration for High-Risk Areas is implemented for CUI systems
- [ ] Review SSP documentation for System and Component Configuration for High-Risk Areas (03.04.12)
- [ ] Validate CMMC Level 2 assessment objective for System and Component Configuration for High-Risk Areas (03.04.12)
- [ ] Confirm POA&M addresses any gaps for System and Component Configuration for High-Risk Areas (03.04.12)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for System and Component Configuration for High-Risk Areas (03.04.12) implementation description and responsible parties.

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

Issue systems or system components with the following configurations to individuals traveling to high-risk locations: [organization-defined].
Apply the following security requirements to the systems or components when the individuals return from travel: [organization-defined].

### Supplemental Guidance

When it is known that a system or a system component will be in a high-risk area, additional security requirements may be needed to counter the increased threat. Organizations can implement protective measures on the systems or system components used by individuals departing on and returning from travel. Actions include determining whether the locations are of concern, defining the required configurations for the components, ensuring that the components are configured as intended before travel is initiated, and taking additional actions after travel is completed. For example, systems going into high-risk areas can be configured with sanitized hard drives, limited applications, and more stringent configuration settings. Actions applied to mobile devices upon return from travel include examining the device for signs of physical tampering and purging and reimaging the device storage.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System and Component Configuration for High-Risk Areas (03.04.12) System and Component Configuration for High-Risk Areas not implemented | Medium | CUI Protection - Configuration Management |
| System and Component Configuration for High-Risk Areas (03.04.12) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents System and Component Configuration for High-Risk Areas (03.04.12) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
