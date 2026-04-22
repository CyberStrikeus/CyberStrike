---
name: "Device Lock (03.01.10)_device-lock"
description: "Prevent access to the system by [organization-defined]."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - device lock (03-01-10)
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

# Device Lock (03.01.10) Device Lock

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Prevent access to the system by [organization-defined].
Retain the device lock until the user reestablishes access using established identification and authentication procedures.
Conceal, via the device lock, information previously visible on the display with a publicly viewable image.

## What to Check

- [ ] Verify Device Lock (03.01.10) Device Lock is implemented for CUI systems
- [ ] Review SSP documentation for Device Lock (03.01.10)
- [ ] Validate CMMC Level 2 assessment objective for Device Lock (03.01.10)
- [ ] Confirm POA&M addresses any gaps for Device Lock (03.01.10)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Device Lock (03.01.10) implementation description and responsible parties.

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

Prevent access to the system by [organization-defined].
Retain the device lock until the user reestablishes access using established identification and authentication procedures.
Conceal, via the device lock, information previously visible on the display with a publicly viewable image.

### Supplemental Guidance

Device locks are temporary actions taken to prevent access to the system when users depart from the immediate vicinity of the system but do not want to log out due to the temporary nature of their absences. Device locks can be implemented at the operating system level or application level. User-initiated device locking is behavior- or policy-based and requires users to take physical action to initiate the device lock. Device locks are not an acceptable substitute for logging out of the system (e.g., when organizations require users to log out at the end of workdays). Publicly viewable images can include static or dynamic images, such as patterns used with screen savers, solid colors, photographic images, a clock, a battery life indicator, or a blank screen with the caveat that controlled unclassified information is not displayed.

## Risk Assessment

| Finding                                              | Severity | Impact                          |
| ---------------------------------------------------- | -------- | ------------------------------- |
| Device Lock (03.01.10) Device Lock not implemented   | High     | CUI Protection - Access Control |
| Device Lock (03.01.10) partially implemented (POA&M) | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Device Lock (03.01.10) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
