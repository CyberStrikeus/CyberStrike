---
name: "Baseline Configuration (03.04.01)_baseline-configuration"
description: "Develop and maintain under configuration control, a current baseline configuration of the system."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - baseline configuration (03-04-01)
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

# Baseline Configuration (03.04.01) Baseline Configuration

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop and maintain under configuration control, a current baseline configuration of the system.
Review and update the baseline configuration of the system [organization-defined] and when system components are installed or modified.

## What to Check

- [ ] Verify Baseline Configuration (03.04.01) Baseline Configuration is implemented for CUI systems
- [ ] Review SSP documentation for Baseline Configuration (03.04.01)
- [ ] Validate CMMC Level 2 assessment objective for Baseline Configuration (03.04.01)
- [ ] Confirm POA&M addresses any gaps for Baseline Configuration (03.04.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Baseline Configuration (03.04.01) implementation description and responsible parties.

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

Develop and maintain under configuration control, a current baseline configuration of the system.
Review and update the baseline configuration of the system [organization-defined] and when system components are installed or modified.

### Supplemental Guidance

Baseline configurations for the system and system components include aspects of connectivity, operation, and communications. Baseline configurations are documented, formally reviewed, and agreed-upon specifications for the system or configuration items within the system. Baseline configurations serve as a basis for future builds, releases, or changes to the system and include information about system components, operational procedures, network topology, and the placement of components in the system architecture. Maintaining baseline configurations requires creating new baselines as the system changes over time. Baseline configurations of the system reflect the current enterprise architecture.

## Risk Assessment

| Finding                                                                  | Severity | Impact                                    |
| ------------------------------------------------------------------------ | -------- | ----------------------------------------- |
| Baseline Configuration (03.04.01) Baseline Configuration not implemented | Medium   | CUI Protection - Configuration Management |
| Baseline Configuration (03.04.01) partially implemented (POA&M)          | Low      | CMMC certification risk                   |

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

- [ ] SSP documents Baseline Configuration (03.04.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
