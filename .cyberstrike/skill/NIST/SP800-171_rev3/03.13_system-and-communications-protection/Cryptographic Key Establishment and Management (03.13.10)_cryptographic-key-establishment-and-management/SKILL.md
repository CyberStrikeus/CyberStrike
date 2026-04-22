---
name: "Cryptographic Key Establishment and Management (03.13.10)_cryptographic-key-establishment-and-management"
description: "Cryptographic Key Establishment and Management"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - cryptographic key establishment and management (03-13-10)
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

# Cryptographic Key Establishment and Management (03.13.10) Cryptographic Key Establishment and Management

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Cryptographic Key Establishment and Management

## What to Check

- [ ] Verify Cryptographic Key Establishment and Management (03.13.10) Cryptographic Key Establishment and Management is implemented for CUI systems
- [ ] Review SSP documentation for Cryptographic Key Establishment and Management (03.13.10)
- [ ] Validate CMMC Level 2 assessment objective for Cryptographic Key Establishment and Management (03.13.10)
- [ ] Confirm POA&M addresses any gaps for Cryptographic Key Establishment and Management (03.13.10)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Cryptographic Key Establishment and Management (03.13.10) implementation description and responsible parties.

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

Implement Cryptographic Key Establishment and Management per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Cryptographic keys can be established and managed using either manual procedures or automated mechanisms supported by manual procedures. Organizations satisfy key establishment and management requirements in accordance with applicable federal laws, Executive Orders, policies, directives, regulations, and standards that specify appropriate options, levels, and parameters. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.11) 03.13.11.

## Risk Assessment

| Finding                                                                                                                  | Severity | Impact                                                |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------- |
| Cryptographic Key Establishment and Management (03.13.10) Cryptographic Key Establishment and Management not implemented | High     | CUI Protection - System and Communications Protection |
| Cryptographic Key Establishment and Management (03.13.10) partially implemented (POA&M)                                  | Medium   | CMMC certification risk                               |

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

- [ ] SSP documents Cryptographic Key Establishment and Management (03.13.10) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
