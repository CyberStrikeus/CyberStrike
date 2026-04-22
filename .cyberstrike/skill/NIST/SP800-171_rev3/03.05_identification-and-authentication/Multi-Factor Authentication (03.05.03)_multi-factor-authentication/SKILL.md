---
name: "Multi-Factor Authentication (03.05.03)_multi-factor-authentication"
description: "Multi-Factor Authentication"
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - multi-factor authentication (03-05-03)
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

# Multi-Factor Authentication (03.05.03) Multi-Factor Authentication

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Multi-Factor Authentication

## What to Check

- [ ] Verify Multi-Factor Authentication (03.05.03) Multi-Factor Authentication is implemented for CUI systems
- [ ] Review SSP documentation for Multi-Factor Authentication (03.05.03)
- [ ] Validate CMMC Level 2 assessment objective for Multi-Factor Authentication (03.05.03)
- [ ] Confirm POA&M addresses any gaps for Multi-Factor Authentication (03.05.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Multi-Factor Authentication (03.05.03) implementation description and responsible parties.

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

Implement Multi-Factor Authentication per NIST SP 800-171 Rev 3.

### Supplemental Guidance

This requirement applies to user accounts. Multi-factor authentication requires the use of two or more different factors to achieve authentication. The authentication factors are defined as follows: something you know (e.g., a personal identification number .PIN), something you have (e.g., a physical authenticator, such as a cryptographic private key), or something you are (e.g., a biometric). Multi-factor authentication solutions that feature physical authenticators include hardware authenticators that provide time-based or challenge-response outputs and smart cards. In addition to authenticating users at the system level, organizations may also employ authentication mechanisms at the application level to provide increased information security.

## Risk Assessment

| Finding                                                                            | Severity | Impact                                             |
| ---------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| Multi-Factor Authentication (03.05.03) Multi-Factor Authentication not implemented | High     | CUI Protection - Identification and Authentication |
| Multi-Factor Authentication (03.05.03) partially implemented (POA&M)               | Medium   | CMMC certification risk                            |

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

- [ ] SSP documents Multi-Factor Authentication (03.05.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
