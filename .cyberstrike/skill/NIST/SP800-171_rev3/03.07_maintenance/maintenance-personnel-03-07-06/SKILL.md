---
name: "Maintenance Personnel (03.07.06)_maintenance-personnel"
description: "Establish a process for maintenance personnel authorization."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - maintenance personnel (03-07-06)
  - family-03.07
  - cui-protection
  - cmmc
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Maintenance Personnel (03.07.06) Maintenance Personnel

## High-Level Description

**Family:** Maintenance
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Establish a process for maintenance personnel authorization.
Maintain a list of authorized maintenance organizations or personnel.
Verify that non-escorted personnel who perform maintenance on the system possess the required access authorizations.
Designate organizational personnel with required access authorizations and technical competence to supervise the maintenance activities of personnel who do not possess the required access authorizations.

## What to Check

- [ ] Verify Maintenance Personnel (03.07.06) Maintenance Personnel is implemented for CUI systems
- [ ] Review SSP documentation for Maintenance Personnel (03.07.06)
- [ ] Validate CMMC Level 2 assessment objective for Maintenance Personnel (03.07.06)
- [ ] Confirm POA&M addresses any gaps for Maintenance Personnel (03.07.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Maintenance Personnel (03.07.06) implementation description and responsible parties.

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

Establish a process for maintenance personnel authorization.
Maintain a list of authorized maintenance organizations or personnel.
Verify that non-escorted personnel who perform maintenance on the system possess the required access authorizations.
Designate organizational personnel with required access authorizations and technical competence to supervise the maintenance activities of personnel who do not possess the required access authorizations.

### Supplemental Guidance

Maintenance personnel refers to individuals who perform hardware or software maintenance on the system, while [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.10.01)03.10.01 addresses physical access for individuals whose maintenance duties place them within the physical protection perimeter of the system. The technical competence of supervising individuals relates to the maintenance performed on the system, while having required access authorizations refers to maintenance on and near the system. Individuals who have not been previously identified as authorized maintenance personnel (e.g., manufacturers, consultants, systems integrators, and vendors) may require privileged access to the system, such as when they are required to conduct maintenance with little or no notice. Organizations may choose to issue temporary credentials to these individuals based on their risk assessments. Temporary credentials may be for one-time use or for very limited time periods.

## Risk Assessment

| Finding                                                                | Severity | Impact                       |
| ---------------------------------------------------------------------- | -------- | ---------------------------- |
| Maintenance Personnel (03.07.06) Maintenance Personnel not implemented | Medium   | CUI Protection - Maintenance |
| Maintenance Personnel (03.07.06) partially implemented (POA&M)         | Low      | CMMC certification risk      |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Maintenance Personnel (03.07.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
