---
name: "Nonlocal Maintenance (03.07.05)_nonlocal-maintenance"
description: "Approve and monitor nonlocal maintenance and diagnostic activities."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - nonlocal maintenance (03-07-05)
  - family-03.07
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

# Nonlocal Maintenance (03.07.05) Nonlocal Maintenance

## High-Level Description

**Family:** Maintenance
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Approve and monitor nonlocal maintenance and diagnostic activities.
Implement multi-factor authentication and replay resistance in the establishment of nonlocal maintenance and diagnostic sessions.
Terminate session and network connections when nonlocal maintenance is completed.

## What to Check

- [ ] Verify Nonlocal Maintenance (03.07.05) Nonlocal Maintenance is implemented for CUI systems
- [ ] Review SSP documentation for Nonlocal Maintenance (03.07.05)
- [ ] Validate CMMC Level 2 assessment objective for Nonlocal Maintenance (03.07.05)
- [ ] Confirm POA&M addresses any gaps for Nonlocal Maintenance (03.07.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Nonlocal Maintenance (03.07.05) implementation description and responsible parties.

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

Approve and monitor nonlocal maintenance and diagnostic activities.
Implement multi-factor authentication and replay resistance in the establishment of nonlocal maintenance and diagnostic sessions.
Terminate session and network connections when nonlocal maintenance is completed.

### Supplemental Guidance

Nonlocal maintenance and diagnostic activities are conducted by individuals who communicate through an external or internal network. Local maintenance and diagnostic activities are carried out by individuals who are physically present at the location of the system and not communicating across a network connection. Authentication techniques used to establish nonlocal maintenance and diagnostic sessions reflect the requirements in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.05.01) 03.05.01.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Nonlocal Maintenance (03.07.05) Nonlocal Maintenance not implemented | Medium | CUI Protection - Maintenance |
| Nonlocal Maintenance (03.07.05) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Nonlocal Maintenance (03.07.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
