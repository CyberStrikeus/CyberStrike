---
name: "Device Identification and Authentication (03.05.02)_device-identification-and-authentication"
description: "Device Identification and Authentication"
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - device identification and authentication (03-05-02)
  - family-03.05
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - active-directory
  - linux
  - windows
cwe_ids:
  - CWE-287
chains_with: []
prerequisites: []
severity_boost: {}
---

# Device Identification and Authentication (03.05.02) Device Identification and Authentication

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Device Identification and Authentication

## What to Check

- [ ] Verify Device Identification and Authentication (03.05.02) Device Identification and Authentication is implemented for CUI systems
- [ ] Review SSP documentation for Device Identification and Authentication (03.05.02)
- [ ] Validate CMMC Level 2 assessment objective for Device Identification and Authentication (03.05.02)
- [ ] Confirm POA&M addresses any gaps for Device Identification and Authentication (03.05.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Device Identification and Authentication (03.05.02) implementation description and responsible parties.

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

Implement Device Identification and Authentication per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Devices that require unique device-to-device identification and authentication are defined by type, device, or a combination of type and device. Organization-defined device types include devices that are not owned by the organization. Systems use shared known information (e.g., Media Access Control .MAC, Transmission Control Protocol/Internet Protocol .TCP/IP addresses) for device identification or organizational authentication solutions (e.g., Institute of Electrical and Electronics Engineers .IEEE 802.1x and Extensible Authentication Protocol .EAP, RADIUS server with EAP-Transport Layer Security .TLS authentication, Kerberos) to identify and authenticate devices on local and wide area networks. Public Key Infrastructure (PKI) and certificate revocation checking for the certificates exchanged can be included as part of device authentication.

## Risk Assessment

| Finding                                                                                                      | Severity | Impact                                             |
| ------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| Device Identification and Authentication (03.05.02) Device Identification and Authentication not implemented | High     | CUI Protection - Identification and Authentication |
| Device Identification and Authentication (03.05.02) partially implemented (POA&M)                            | Medium   | CMMC certification risk                            |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-287 | Improper Authentication |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Device Identification and Authentication (03.05.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
