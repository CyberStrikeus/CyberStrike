---
name: "Media Marking (03.08.04)_media-marking"
description: "Media Marking"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - media marking (03-08-04)
  - family-03.08
  - cui-protection
  - cmmc
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Media Marking (03.08.04) Media Marking

## High-Level Description

**Family:** Media Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Media Marking

## What to Check

- [ ] Verify Media Marking (03.08.04) Media Marking is implemented for CUI systems
- [ ] Review SSP documentation for Media Marking (03.08.04)
- [ ] Validate CMMC Level 2 assessment objective for Media Marking (03.08.04)
- [ ] Confirm POA&M addresses any gaps for Media Marking (03.08.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Media Marking (03.08.04) implementation description and responsible parties.

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

Implement Media Marking per NIST SP 800-171 Rev 3.

### Supplemental Guidance

System media include digital and non-digital media. Marking refers to the use or application of human-readable security attributes. Labeling refers to the use of security attributes for internal system data structures. Digital media include diskettes, magnetic tapes, external or removable solid state or magnetic drives, flash drives, compact discs, and digital versatile discs. Non-digital media include paper and microfilm. CUI is defined by NARA along with marking, safeguarding, and dissemination requirements for such information.

## Risk Assessment

| Finding                                                | Severity | Impact                            |
| ------------------------------------------------------ | -------- | --------------------------------- |
| Media Marking (03.08.04) Media Marking not implemented | Medium   | CUI Protection - Media Protection |
| Media Marking (03.08.04) partially implemented (POA&M) | Low      | CMMC certification risk           |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Media Marking (03.08.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
