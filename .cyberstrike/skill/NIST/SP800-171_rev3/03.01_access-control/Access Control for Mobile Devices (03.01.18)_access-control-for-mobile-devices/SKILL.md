---
name: "Access Control for Mobile Devices (03.01.18)_access-control-for-mobile-devices"
description: "Establish usage restrictions, configuration requirements, and connection requirements for mobile devices."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - access control for mobile devices (03-01-18)
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

# Access Control for Mobile Devices (03.01.18) Access Control for Mobile Devices

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Establish usage restrictions, configuration requirements, and connection requirements for mobile devices.
Authorize the connection of mobile devices to the system.
Implement full-device or container-based encryption to protect the confidentiality of CUI on mobile devices.

## What to Check

- [ ] Verify Access Control for Mobile Devices (03.01.18) Access Control for Mobile Devices is implemented for CUI systems
- [ ] Review SSP documentation for Access Control for Mobile Devices (03.01.18)
- [ ] Validate CMMC Level 2 assessment objective for Access Control for Mobile Devices (03.01.18)
- [ ] Confirm POA&M addresses any gaps for Access Control for Mobile Devices (03.01.18)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Access Control for Mobile Devices (03.01.18) implementation description and responsible parties.

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

Establish usage restrictions, configuration requirements, and connection requirements for mobile devices.
Authorize the connection of mobile devices to the system.
Implement full-device or container-based encryption to protect the confidentiality of CUI on mobile devices.

### Supplemental Guidance

A mobile device is a computing device with a small form factor such that it can be carried by a single individual; is designed to operate without a physical connection; possesses local, non-removable, or removable data storage; and includes a self-contained power source. Mobile device functionality may include on-board sensors that allow the device to capture information, voice communication capabilities, and/or built-in features for synchronizing local data with remote locations. Examples include smart phones, smart watches, and tablets. Mobile devices are typically associated with a single individual. The processing, storage, and transmission capabilities of mobile devices may be comparable to or a subset of notebook or desktop systems, depending on the nature and intended purpose of the device. Some organizations may consider notebook computers to be mobile devices. The protection and control of mobile devices are behavior- or policy-based and require users to take physical action to protect and control such devices when outside of controlled areas. Controlled areas are spaces for which the organization provides physical or procedural controls to meet the requirements established for protecting CUI. Due to the large variety of mobile devices with different characteristics and capabilities, organizational restrictions may vary for the different classes or types of such devices. Usage restrictions, configuration requirements, and connection requirements for mobile devices include configuration management, device identification and authentication, implementing mandatory protective software, scanning devices for malicious code, updating virus protection software, scanning for critical software updates and patches, conducting operating system and possibly other software integrity checks, and disabling unnecessary hardware. On mobile devices, secure containers provide software-based data isolation designed to segment enterprise applications and information from personal apps and data. Containers may present multiple user interfaces, one of the most common being a mobile application that acts as a portal to a suite of business productivity apps, such as email, contacts, and calendar. Organizations can employ full-device encryption or container-based encryption to protect the confidentiality of CUI on mobile devices.

## Risk Assessment

| Finding                                                                                        | Severity | Impact                          |
| ---------------------------------------------------------------------------------------------- | -------- | ------------------------------- |
| Access Control for Mobile Devices (03.01.18) Access Control for Mobile Devices not implemented | High     | CUI Protection - Access Control |
| Access Control for Mobile Devices (03.01.18) partially implemented (POA&M)                     | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Access Control for Mobile Devices (03.01.18) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
