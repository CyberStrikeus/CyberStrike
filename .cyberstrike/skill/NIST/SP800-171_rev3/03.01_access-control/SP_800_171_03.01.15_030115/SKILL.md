---
name: "SP_800_171_03.01.15_030115"
description: "03.01.15"
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - sp_800_171_03-01-15
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

# SP_800_171_03.01.15 03.01.15

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

03.01.15

## What to Check

- [ ] Verify SP_800_171_03.01.15 03.01.15 is implemented for CUI systems
- [ ] Review SSP documentation for SP_800_171_03.01.15
- [ ] Validate CMMC Level 2 assessment objective for SP_800_171_03.01.15
- [ ] Confirm POA&M addresses any gaps for SP_800_171_03.01.15

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for SP_800_171_03.01.15 implementation description and responsible parties.

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

Implement 03.01.15 per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Refer to SP 800-171A Rev 3 for detailed assessment procedures.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SP_800_171_03.01.15 03.01.15 not implemented | High | CUI Protection - Access Control |
| SP_800_171_03.01.15 partially implemented (POA&M) | Medium | CMMC certification risk |

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

- [ ] SSP documents SP_800_171_03.01.15 implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
