---
name: "Session Authenticity (03.13.15)_session-authenticity"
description: "Session Authenticity"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - session authenticity (03-13-15)
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

# Session Authenticity (03.13.15) Session Authenticity

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Session Authenticity

## What to Check

- [ ] Verify Session Authenticity (03.13.15) Session Authenticity is implemented for CUI systems
- [ ] Review SSP documentation for Session Authenticity (03.13.15)
- [ ] Validate CMMC Level 2 assessment objective for Session Authenticity (03.13.15)
- [ ] Confirm POA&M addresses any gaps for Session Authenticity (03.13.15)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Session Authenticity (03.13.15) implementation description and responsible parties.

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

Implement Session Authenticity per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Protecting session authenticity addresses communications protection at the session level, not at the packet level. Such protection establishes grounds for confidence at both ends of the communications sessions in the ongoing identities of other parties and the validity of the transmitted information. Authenticity protection includes protecting against adversary-in-the-middle attacks, session hijacking, and the insertion of false information into sessions.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Session Authenticity (03.13.15) Session Authenticity not implemented | High | CUI Protection - System and Communications Protection |
| Session Authenticity (03.13.15) partially implemented (POA&M) | Medium | CMMC certification risk |

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

- [ ] SSP documents Session Authenticity (03.13.15) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
