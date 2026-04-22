---
name: "Risk Response (03.11.04)_risk-response"
description: "Risk Response"
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - risk response (03-11-04)
  - family-03.11
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Risk Response (03.11.04) Risk Response

## High-Level Description

**Family:** Risk Assessment
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Risk Response

## What to Check

- [ ] Verify Risk Response (03.11.04) Risk Response is implemented for CUI systems
- [ ] Review SSP documentation for Risk Response (03.11.04)
- [ ] Validate CMMC Level 2 assessment objective for Risk Response (03.11.04)
- [ ] Confirm POA&M addresses any gaps for Risk Response (03.11.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Risk Response (03.11.04) implementation description and responsible parties.

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

Implement Risk Response per NIST SP 800-171 Rev 3.

### Supplemental Guidance

This requirement addresses the need to determine an appropriate response to risk before generating a plan of action and milestones (POAM) entry. It may be possible to mitigate the risk immediately so that a POAM entry is not needed. However, a POAM entry is generated if the risk response is to mitigate the identified risk and the mitigation cannot be completed immediately.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Risk Response (03.11.04) Risk Response not implemented | Medium | CUI Protection - Risk Assessment |
| Risk Response (03.11.04) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Risk Response (03.11.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
