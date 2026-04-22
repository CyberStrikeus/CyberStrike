---
name: "Wireless Access (03.01.16)_wireless-access"
description: "Establish usage restrictions, configuration requirements, and connection requirements for each type of wireless access to the system."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - wireless access (03-01-16)
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
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Wireless Access (03.01.16) Wireless Access

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Establish usage restrictions, configuration requirements, and connection requirements for each type of wireless access to the system.
Authorize each type of wireless access to the system prior to establishing such connections.
Disable, when not intended for use, wireless networking capabilities prior to issuance and deployment.
Protect wireless access to the system using authentication and encryption.

## What to Check

- [ ] Verify Wireless Access (03.01.16) Wireless Access is implemented for CUI systems
- [ ] Review SSP documentation for Wireless Access (03.01.16)
- [ ] Validate CMMC Level 2 assessment objective for Wireless Access (03.01.16)
- [ ] Confirm POA&M addresses any gaps for Wireless Access (03.01.16)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Wireless Access (03.01.16) implementation description and responsible parties.

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

Establish usage restrictions, configuration requirements, and connection requirements for each type of wireless access to the system.
Authorize each type of wireless access to the system prior to establishing such connections.
Disable, when not intended for use, wireless networking capabilities prior to issuance and deployment.
Protect wireless access to the system using authentication and encryption.

### Supplemental Guidance

Wireless networking capabilities represent a significant potential vulnerability that can be exploited by adversaries. Establishing usage restrictions, configuration requirements, and connection requirements for wireless access to the system provides criteria to support access authorization decisions. These restrictions and requirements reduce susceptibility to unauthorized system access through wireless technologies. Wireless networks use authentication protocols that provide credential protection and mutual authentication. Organizations authenticate individuals and devices to protect wireless access to the system. Special attention is given to the variety of devices with potential wireless access to the system, including small form factor mobile devices (e.g., smart phones, tablets, smart watches). Wireless networking capabilities that are embedded within system components represent a potential vulnerability that can be exploited by adversaries. Strong authentication of users and devices, strong encryption, and disabling wireless capabilities that are not needed for essential mission or business functions can reduce susceptibility to threats by adversaries involving wireless technologies.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Wireless Access (03.01.16) Wireless Access not implemented | High | CUI Protection - Access Control |
| Wireless Access (03.01.16) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Wireless Access (03.01.16) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
