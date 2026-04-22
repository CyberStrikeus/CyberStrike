---
name: "Media Access (03.08.02)_media-access"
description: "Media Access"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - media access (03-08-02)
  - family-03.08
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

# Media Access (03.08.02) Media Access

## High-Level Description

**Family:** Media Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Media Access

## What to Check

- [ ] Verify Media Access (03.08.02) Media Access is implemented for CUI systems
- [ ] Review SSP documentation for Media Access (03.08.02)
- [ ] Validate CMMC Level 2 assessment objective for Media Access (03.08.02)
- [ ] Confirm POA&M addresses any gaps for Media Access (03.08.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Media Access (03.08.02) implementation description and responsible parties.

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

Implement Media Access per NIST SP 800-171 Rev 3.

### Supplemental Guidance

System media include digital and non-digital media. Access to CUI on system media can be restricted by physically controlling such media. This includes conducting inventories, ensuring that procedures are in place to allow individuals to check out and return media to the media library, and maintaining accountability for stored media. For digital media, access to CUI can be restricted by using cryptographic means. Encrypting data in storage or at rest is addressed in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.08) 03.13.08.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Media Access (03.08.02) Media Access not implemented | Medium | CUI Protection - Media Protection |
| Media Access (03.08.02) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Media Access (03.08.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
