---
name: "Collaborative Computing Devices and Applications (03.13.12)_collaborative-computing-devices-and-applications"
description: "Prohibit the remote activation of collaborative computing devices and applications with the following exceptions: [organization-defined]."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - collaborative computing devices and applications (03-13-12)
  - family-03.13
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
  - network
cwe_ids:
  - CWE-311
chains_with: []
prerequisites: []
severity_boost: {}
---

# Collaborative Computing Devices and Applications (03.13.12) Collaborative Computing Devices and Applications

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Prohibit the remote activation of collaborative computing devices and applications with the following exceptions: [organization-defined].
Provide an explicit indication of use to users physically present at the devices.

## What to Check

- [ ] Verify Collaborative Computing Devices and Applications (03.13.12) Collaborative Computing Devices and Applications is implemented for CUI systems
- [ ] Review SSP documentation for Collaborative Computing Devices and Applications (03.13.12)
- [ ] Validate CMMC Level 2 assessment objective for Collaborative Computing Devices and Applications (03.13.12)
- [ ] Confirm POA&M addresses any gaps for Collaborative Computing Devices and Applications (03.13.12)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Collaborative Computing Devices and Applications (03.13.12) implementation description and responsible parties.

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

Prohibit the remote activation of collaborative computing devices and applications with the following exceptions: [organization-defined].
Provide an explicit indication of use to users physically present at the devices.

### Supplemental Guidance

Collaborative computing devices include white boards, microphones, and cameras. Notebook computers, smartphones, display monitors, and tablets containing cameras and microphones are considered part of collaborative computing devices when conferencing software is in use. Indication of use includes notifying users (e.g., a pop-up menu stating that recording is in progress or that the microphone has been turned on) when collaborative computing devices are activated. Dedicated video conferencing systems, which typically rely on one of the participants calling or connecting to the other party to activate the video conference, are excluded. Solutions to prevent device usage include webcam covers and buttons to disable microphones.

## Risk Assessment

| Finding                                                                                                                      | Severity | Impact                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Collaborative Computing Devices and Applications (03.13.12) Collaborative Computing Devices and Applications not implemented | High     | CUI Protection - System and Communications Protection |
| Collaborative Computing Devices and Applications (03.13.12) partially implemented (POA&M)                                    | Medium   | CMMC certification risk                               |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Collaborative Computing Devices and Applications (03.13.12) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
