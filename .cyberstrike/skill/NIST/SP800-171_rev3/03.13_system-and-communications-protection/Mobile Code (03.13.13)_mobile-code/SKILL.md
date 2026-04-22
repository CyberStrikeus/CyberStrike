---
name: "Mobile Code (03.13.13)_mobile-code"
description: "Define acceptable mobile code and mobile code technologies."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - mobile code (03-13-13)
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

# Mobile Code (03.13.13) Mobile Code

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Define acceptable mobile code and mobile code technologies.
Authorize, monitor, and control the use of mobile code.

## What to Check

- [ ] Verify Mobile Code (03.13.13) Mobile Code is implemented for CUI systems
- [ ] Review SSP documentation for Mobile Code (03.13.13)
- [ ] Validate CMMC Level 2 assessment objective for Mobile Code (03.13.13)
- [ ] Confirm POA&M addresses any gaps for Mobile Code (03.13.13)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Mobile Code (03.13.13) implementation description and responsible parties.

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

Define acceptable mobile code and mobile code technologies.
Authorize, monitor, and control the use of mobile code.

### Supplemental Guidance

Mobile code includes software programs or parts of programs that are obtained from remote systems, transmitted across a network, and executed on a local system without explicit installation or execution by the recipient. Decisions regarding the use of mobile code are based on the potential for the code to cause damage to the system if used maliciously. Mobile code technologies include Java applets, JavaScript, HTML5, VBScript, and WebGL. Usage restrictions and implementation guidelines apply to the selection and use of mobile code installed on servers and downloaded and executed on individual workstations and devices, including notebook computers, smart phones, and smart devices. Mobile code policies and procedures address the actions taken to prevent the development, acquisition, and use of unacceptable mobile code within the system, including requiring mobile code to be digitally signed by a trusted source.

## Risk Assessment

| Finding                                              | Severity | Impact                                                |
| ---------------------------------------------------- | -------- | ----------------------------------------------------- |
| Mobile Code (03.13.13) Mobile Code not implemented   | High     | CUI Protection - System and Communications Protection |
| Mobile Code (03.13.13) partially implemented (POA&M) | Medium   | CMMC certification risk                               |

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

- [ ] SSP documents Mobile Code (03.13.13) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
