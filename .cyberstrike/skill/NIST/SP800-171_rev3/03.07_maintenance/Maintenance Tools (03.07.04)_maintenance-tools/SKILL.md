---
name: "Maintenance Tools (03.07.04)_maintenance-tools"
description: "Approve, control, and monitor the use of system maintenance tools."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - maintenance tools (03-07-04)
  - family-03.07
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

# Maintenance Tools (03.07.04) Maintenance Tools

## High-Level Description

**Family:** Maintenance
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Approve, control, and monitor the use of system maintenance tools.
Check media with diagnostic and test programs for malicious code before it is used in the system.
Prevent the removal of system maintenance equipment containing CUI by verifying that there is no CUI on the equipment, sanitizing or destroying the equipment, or retaining the equipment within the facility.

## What to Check

- [ ] Verify Maintenance Tools (03.07.04) Maintenance Tools is implemented for CUI systems
- [ ] Review SSP documentation for Maintenance Tools (03.07.04)
- [ ] Validate CMMC Level 2 assessment objective for Maintenance Tools (03.07.04)
- [ ] Confirm POA&M addresses any gaps for Maintenance Tools (03.07.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Maintenance Tools (03.07.04) implementation description and responsible parties.

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

Approve, control, and monitor the use of system maintenance tools.
Check media with diagnostic and test programs for malicious code before it is used in the system.
Prevent the removal of system maintenance equipment containing CUI by verifying that there is no CUI on the equipment, sanitizing or destroying the equipment, or retaining the equipment within the facility.

### Supplemental Guidance

Approving, controlling, monitoring, and reviewing maintenance tools address security-related issues associated with the tools that are used for diagnostic and repair actions on the system. Maintenance tools can include hardware and software diagnostic and test equipment as well as packet sniffers. The tools may be pre-installed, brought in with maintenance personnel on media, cloud-based, or downloaded from a website. Diagnostic and test programs are potential vehicles for transporting malicious code into the system, either intentionally or unintentionally. Examples of media inspection include checking the cryptographic hash or digital signatures of diagnostic and test programs and media. If organizations inspect media that contain diagnostic and test programs and determine that the media also contain malicious code, the incident is handled consistent with incident handling policies and procedures. A periodic review of system maintenance tools can result in the withdrawal of approval for outdated, unsupported, irrelevant, or no-longer-used tools. Maintenance tools do not address the hardware and software components that support maintenance and are considered a part of the system.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Maintenance Tools (03.07.04) Maintenance Tools not implemented | Medium | CUI Protection - Maintenance |
| Maintenance Tools (03.07.04) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Maintenance Tools (03.07.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
