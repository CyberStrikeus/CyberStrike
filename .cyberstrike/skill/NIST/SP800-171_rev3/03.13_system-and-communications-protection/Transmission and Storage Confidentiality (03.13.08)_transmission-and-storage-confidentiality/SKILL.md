---
name: "Transmission and Storage Confidentiality (03.13.08)_transmission-and-storage-confidentiality"
description: "Transmission and Storage Confidentiality"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - transmission and storage confidentiality (03-13-08)
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
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Transmission and Storage Confidentiality (03.13.08) Transmission and Storage Confidentiality

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Transmission and Storage Confidentiality

## What to Check

- [ ] Verify Transmission and Storage Confidentiality (03.13.08) Transmission and Storage Confidentiality is implemented for CUI systems
- [ ] Review SSP documentation for Transmission and Storage Confidentiality (03.13.08)
- [ ] Validate CMMC Level 2 assessment objective for Transmission and Storage Confidentiality (03.13.08)
- [ ] Confirm POA&M addresses any gaps for Transmission and Storage Confidentiality (03.13.08)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Transmission and Storage Confidentiality (03.13.08) implementation description and responsible parties.

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

Implement Transmission and Storage Confidentiality per NIST SP 800-171 Rev 3.

### Supplemental Guidance

This requirement applies to internal and external networks and any system components that can transmit CUI, including servers, notebook computers, desktop computers, mobile devices, printers, copiers, scanners, facsimile machines, and radios. Unprotected communication paths are susceptible to interception and modification. Encryption protects CUI from unauthorized disclosure during transmission and while in storage. Cryptographic mechanisms that protect the confidentiality of CUI during transmission include TLS and IPsec. Information in storage (i.e., information at rest) refers to the state of CUI when it is not in process or in transit and resides on internal or external storage devices, storage area network devices, and databases. Protecting CUI in storage does not focus on the type of storage device or the frequency of access to that device but rather on the state of the information. This requirement relates to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.11) 03.13.11.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Transmission and Storage Confidentiality (03.13.08) Transmission and Storage Confidentiality not implemented | High | CUI Protection - System and Communications Protection |
| Transmission and Storage Confidentiality (03.13.08) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Transmission and Storage Confidentiality (03.13.08) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
