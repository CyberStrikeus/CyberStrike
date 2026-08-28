---
name: "Access Enforcement (03.01.02)_access-enforcement"
description: "Access Enforcement"
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - access enforcement (03-01-02)
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

# Access Enforcement (03.01.02) Access Enforcement

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Access Enforcement

## What to Check

- [ ] Verify Access Enforcement (03.01.02) Access Enforcement is implemented for CUI systems
- [ ] Review SSP documentation for Access Enforcement (03.01.02)
- [ ] Validate CMMC Level 2 assessment objective for Access Enforcement (03.01.02)
- [ ] Confirm POA&M addresses any gaps for Access Enforcement (03.01.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Access Enforcement (03.01.02) implementation description and responsible parties.

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

Implement Access Enforcement per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Access control policies control access between active entities or subjects (i.e., users or system processes acting on behalf of users) and passive entities or objects (i.e., devices, files, records, domains) in organizational systems. Types of system access include remote access and access to systems that communicate through external networks, such as the internet. Access enforcement mechanisms can also be employed at the application and service levels to provide increased protection for CUI. This recognizes that the system can host many applications and services in support of mission and business functions. Access control policies are defined in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.15.01) 03.15.01.

## Risk Assessment

| Finding                                                          | Severity | Impact                          |
| ---------------------------------------------------------------- | -------- | ------------------------------- |
| Access Enforcement (03.01.02) Access Enforcement not implemented | High     | CUI Protection - Access Control |
| Access Enforcement (03.01.02) partially implemented (POA&M)      | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Access Enforcement (03.01.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
