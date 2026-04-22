---
name: "SP_800_171_03.05.06_030506"
description: "03.05.06"
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - sp_800_171_03-05-06
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

# SP_800_171_03.05.06 03.05.06

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

03.05.06

## What to Check

- [ ] Verify SP_800_171_03.05.06 03.05.06 is implemented for CUI systems
- [ ] Review SSP documentation for SP_800_171_03.05.06
- [ ] Validate CMMC Level 2 assessment objective for SP_800_171_03.05.06
- [ ] Confirm POA&M addresses any gaps for SP_800_171_03.05.06

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for SP_800_171_03.05.06 implementation description and responsible parties.

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

Implement 03.05.06 per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Refer to SP 800-171A Rev 3 for detailed assessment procedures.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SP_800_171_03.05.06 03.05.06 not implemented | High | CUI Protection - Identification and Authentication |
| SP_800_171_03.05.06 partially implemented (POA&M) | Medium | CMMC certification risk |

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

- [ ] SSP documents SP_800_171_03.05.06 implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
