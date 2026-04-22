---
name: "Cryptographic Protection (03.13.11)_cryptographic-protection"
description: "Cryptographic Protection"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - cryptographic protection (03-13-11)
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

# Cryptographic Protection (03.13.11) Cryptographic Protection

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Cryptographic Protection

## What to Check

- [ ] Verify Cryptographic Protection (03.13.11) Cryptographic Protection is implemented for CUI systems
- [ ] Review SSP documentation for Cryptographic Protection (03.13.11)
- [ ] Validate CMMC Level 2 assessment objective for Cryptographic Protection (03.13.11)
- [ ] Confirm POA&M addresses any gaps for Cryptographic Protection (03.13.11)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Cryptographic Protection (03.13.11) implementation description and responsible parties.

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

Implement Cryptographic Protection per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Cryptography is implemented in accordance with applicable laws, Executive Orders, directives, regulations, policies, standards, and guidelines. FIPS-validated cryptography is recommended for the protection of CUI.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cryptographic Protection (03.13.11) Cryptographic Protection not implemented | High | CUI Protection - System and Communications Protection |
| Cryptographic Protection (03.13.11) partially implemented (POA&M) | Medium | CMMC certification risk |

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

- [ ] SSP documents Cryptographic Protection (03.13.11) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
