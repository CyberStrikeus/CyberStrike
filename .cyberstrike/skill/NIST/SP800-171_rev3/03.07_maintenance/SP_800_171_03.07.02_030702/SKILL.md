---
name: "SP_800_171_03.07.02_030702"
description: "03.07.02"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - sp_800_171_03-07-02
  - family-03.07
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

# SP_800_171_03.07.02 03.07.02

## High-Level Description

**Family:** Maintenance
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

03.07.02

## What to Check

- [ ] Verify SP_800_171_03.07.02 03.07.02 is implemented for CUI systems
- [ ] Review SSP documentation for SP_800_171_03.07.02
- [ ] Validate CMMC Level 2 assessment objective for SP_800_171_03.07.02
- [ ] Confirm POA&M addresses any gaps for SP_800_171_03.07.02

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for SP_800_171_03.07.02 implementation description and responsible parties.

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

Implement 03.07.02 per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Refer to SP 800-171A Rev 3 for detailed assessment procedures.

## Risk Assessment

| Finding                                           | Severity | Impact                       |
| ------------------------------------------------- | -------- | ---------------------------- |
| SP_800_171_03.07.02 03.07.02 not implemented      | Medium   | CUI Protection - Maintenance |
| SP_800_171_03.07.02 partially implemented (POA&M) | Low      | CMMC certification risk      |

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

- [ ] SSP documents SP_800_171_03.07.02 implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
