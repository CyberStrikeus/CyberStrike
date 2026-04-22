---
name: "Publicly Accessible Content (03.01.22)_publicly-accessible-content"
description: "Train authorized individuals to ensure that publicly accessible information does not contain CUI."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - publicly accessible content (03-01-22)
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
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Publicly Accessible Content (03.01.22) Publicly Accessible Content

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Train authorized individuals to ensure that publicly accessible information does not contain CUI.
Review the content on publicly accessible systems for CUI and remove such information, if discovered.

## What to Check

- [ ] Verify Publicly Accessible Content (03.01.22) Publicly Accessible Content is implemented for CUI systems
- [ ] Review SSP documentation for Publicly Accessible Content (03.01.22)
- [ ] Validate CMMC Level 2 assessment objective for Publicly Accessible Content (03.01.22)
- [ ] Confirm POA&M addresses any gaps for Publicly Accessible Content (03.01.22)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Publicly Accessible Content (03.01.22) implementation description and responsible parties.

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

Train authorized individuals to ensure that publicly accessible information does not contain CUI.
Review the content on publicly accessible systems for CUI and remove such information, if discovered.

### Supplemental Guidance

In accordance with applicable laws, Executive Orders, directives, policies, regulations, standards, and guidelines, the public is not authorized to have access to nonpublic information, including CUI.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Publicly Accessible Content (03.01.22) Publicly Accessible Content not implemented | High | CUI Protection - Access Control |
| Publicly Accessible Content (03.01.22) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Publicly Accessible Content (03.01.22) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
