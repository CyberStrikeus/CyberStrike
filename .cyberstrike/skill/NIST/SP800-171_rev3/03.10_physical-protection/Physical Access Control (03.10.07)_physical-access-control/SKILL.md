---
name: "Physical Access Control (03.10.07)_physical-access-control"
description: "Enforce physical access authorizations at entry and exit points to the facility where the system resides by: Verifying individual physical access auth"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - physical access control (03-10-07)
  - family-03.10
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Physical Access Control (03.10.07) Physical Access Control

## High-Level Description

**Family:** Physical Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Enforce physical access authorizations at entry and exit points to the facility where the system resides by:
Verifying individual physical access authorizations before granting access to the facility and
Controlling ingress and egress with physical access control systems, devices, or guards.
Maintain physical access audit logs for entry or exit points.
Escort visitors, and control visitor activity.
Secure keys, combinations, and other physical access devices.
Control physical access to output devices to prevent unauthorized individuals from obtaining access to CUI.

## What to Check

- [ ] Verify Physical Access Control (03.10.07) Physical Access Control is implemented for CUI systems
- [ ] Review SSP documentation for Physical Access Control (03.10.07)
- [ ] Validate CMMC Level 2 assessment objective for Physical Access Control (03.10.07)
- [ ] Confirm POA&M addresses any gaps for Physical Access Control (03.10.07)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Physical Access Control (03.10.07) implementation description and responsible parties.

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

Enforce physical access authorizations at entry and exit points to the facility where the system resides by:
Verifying individual physical access authorizations before granting access to the facility and
Controlling ingress and egress with physical access control systems, devices, or guards.
Maintain physical access audit logs for entry or exit points.
Escort visitors, and control visitor activity.
Secure keys, combinations, and other physical access devices.
Control physical access to output devices to prevent unauthorized individuals from obtaining access to CUI.

### Supplemental Guidance

This requirement addresses physical locations containing systems or system components that process, store, or transmit CUI. Organizations determine the types of guards needed, including professional security staff or administrative staff. Physical access devices include keys, locks, combinations, biometric readers, and card readers. Physical access control systems comply with applicable laws, Executive Orders, directives, policies, regulations, standards, and guidelines. Organizations have flexibility in the types of audit logs employed. Audit logs can be procedural, automated, or some combination thereof. Physical access points can include exterior access points, interior access points to systems that require supplemental access controls, or both. Physical access control applies to employees and visitors. Individuals with permanent physical access authorizations are not considered visitors. Controlling physical access to output devices includes placing output devices in locked rooms or other secured areas with keypad or card reader access controls and only allowing access to authorized individuals, placing output devices in locations that can be monitored by personnel, installing monitor or screen filters, and using headphones. Examples of output devices include monitors, printers, scanners, facsimile machines, audio devices, and copiers.

## Risk Assessment

| Finding                                                                    | Severity | Impact                               |
| -------------------------------------------------------------------------- | -------- | ------------------------------------ |
| Physical Access Control (03.10.07) Physical Access Control not implemented | Medium   | CUI Protection - Physical Protection |
| Physical Access Control (03.10.07) partially implemented (POA&M)           | Low      | CMMC certification risk              |

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

- [ ] SSP documents Physical Access Control (03.10.07) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
