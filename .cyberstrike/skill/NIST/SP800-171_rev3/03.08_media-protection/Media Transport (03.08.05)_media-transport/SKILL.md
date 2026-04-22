---
name: "Media Transport (03.08.05)_media-transport"
description: "Protect and control system media that contain CUI during transport outside of controlled areas."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - media transport (03-08-05)
  - family-03.08
  - cui-protection
  - cmmc
tech_stack:
  - linux
  - windows
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Media Transport (03.08.05) Media Transport

## High-Level Description

**Family:** Media Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Protect and control system media that contain CUI during transport outside of controlled areas.
Maintain accountability of system media that contain CUI during transport outside of controlled areas.
Document activities associated with the transport of system media that contain CUI.

## What to Check

- [ ] Verify Media Transport (03.08.05) Media Transport is implemented for CUI systems
- [ ] Review SSP documentation for Media Transport (03.08.05)
- [ ] Validate CMMC Level 2 assessment objective for Media Transport (03.08.05)
- [ ] Confirm POA&M addresses any gaps for Media Transport (03.08.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Media Transport (03.08.05) implementation description and responsible parties.

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

Protect and control system media that contain CUI during transport outside of controlled areas.
Maintain accountability of system media that contain CUI during transport outside of controlled areas.
Document activities associated with the transport of system media that contain CUI.

### Supplemental Guidance

System media include digital and non-digital media. Digital media include flash drives, diskettes, magnetic tapes, external or removable solid state or magnetic drives, compact discs, and digital versatile discs. Non-digital media include microfilm and paper. Controlled areas are spaces for which organizations provide physical or procedural measures to meet the requirements established for protecting CUI and systems. Media protection during transport can include cryptography and/or locked containers. Activities associated with media transport include releasing media for transport, ensuring that media enter the appropriate transport processes, and the actual transport. Authorized transport and courier personnel may include individuals external to the organization. Maintaining accountability of media during transport includes restricting transport activities to authorized personnel and tracking or obtaining the records of transport activities as the media move through the transportation system to prevent and detect loss, destruction, or tampering. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.08)03.13.08 and [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.11) 03.13.11.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Media Transport (03.08.05) Media Transport not implemented | Medium | CUI Protection - Media Protection |
| Media Transport (03.08.05) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Media Transport (03.08.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
