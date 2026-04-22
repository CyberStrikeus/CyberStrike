---
name: "Media Sanitization (03.08.03)_media-sanitization"
description: "Media Sanitization"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - media sanitization (03-08-03)
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

# Media Sanitization (03.08.03) Media Sanitization

## High-Level Description

**Family:** Media Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Media Sanitization

## What to Check

- [ ] Verify Media Sanitization (03.08.03) Media Sanitization is implemented for CUI systems
- [ ] Review SSP documentation for Media Sanitization (03.08.03)
- [ ] Validate CMMC Level 2 assessment objective for Media Sanitization (03.08.03)
- [ ] Confirm POA&M addresses any gaps for Media Sanitization (03.08.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Media Sanitization (03.08.03) implementation description and responsible parties.

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

Implement Media Sanitization per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Media sanitization applies to digital and non-digital media that are subject to disposal or reuse, whether or not the media are considered removable. Examples include digital media in scanners, copiers, printers, notebook computers, mobile devices, workstations, network components, and non-digital media. The sanitization process removes CUI from media such that the information cannot be retrieved or reconstructed. Sanitization techniques (e.g., cryptographically erasing, clearing, purging, and destroying) prevent the disclosure of CUI to unauthorized individuals when such media are reused or released for disposal. NARA policies control the sanitization process for media that contain CUI and may require destruction when other methods cannot be applied to the media.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Media Sanitization (03.08.03) Media Sanitization not implemented | Medium | CUI Protection - Media Protection |
| Media Sanitization (03.08.03) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Media Sanitization (03.08.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
