---
name: "Authentication Feedback (03.05.11)_authentication-feedback"
description: "Authentication Feedback"
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - authentication feedback (03-05-11)
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
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Authentication Feedback (03.05.11) Authentication Feedback

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Authentication Feedback

## What to Check

- [ ] Verify Authentication Feedback (03.05.11) Authentication Feedback is implemented for CUI systems
- [ ] Review SSP documentation for Authentication Feedback (03.05.11)
- [ ] Validate CMMC Level 2 assessment objective for Authentication Feedback (03.05.11)
- [ ] Confirm POA&M addresses any gaps for Authentication Feedback (03.05.11)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Authentication Feedback (03.05.11) implementation description and responsible parties.

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

Implement Authentication Feedback per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Authentication feedback does not provide information that would allow unauthorized individuals to compromise authentication mechanisms. For example, for desktop or notebook systems with relatively large monitors, the threat may be significant (commonly referred to as shoulder surfing). For mobile devices with small displays, this threat may be less significant and is balanced against the increased likelihood of input errors due to small keyboards. Therefore, the means of obscuring authenticator feedback is selected accordingly. Obscuring feedback includes displaying asterisks when users type passwords into input devices or displaying feedback for a limited time before fully obscuring it.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Authentication Feedback (03.05.11) Authentication Feedback not implemented | High | CUI Protection - Identification and Authentication |
| Authentication Feedback (03.05.11) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Authentication Feedback (03.05.11) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
