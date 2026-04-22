---
name: "Personnel Screening (03.09.01)_personnel-screening"
description: "Screen individuals prior to authorizing access to the system."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - personnel screening (03-09-01)
  - family-03.09
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

# Personnel Screening (03.09.01) Personnel Screening

## High-Level Description

**Family:** Personnel Security
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Screen individuals prior to authorizing access to the system.
Rescreen individuals in accordance with [organization-defined].

## What to Check

- [ ] Verify Personnel Screening (03.09.01) Personnel Screening is implemented for CUI systems
- [ ] Review SSP documentation for Personnel Screening (03.09.01)
- [ ] Validate CMMC Level 2 assessment objective for Personnel Screening (03.09.01)
- [ ] Confirm POA&M addresses any gaps for Personnel Screening (03.09.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Personnel Screening (03.09.01) implementation description and responsible parties.

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

Screen individuals prior to authorizing access to the system.
Rescreen individuals in accordance with [organization-defined].

### Supplemental Guidance

Personnel security screening activities involve the assessment of the conduct, integrity, judgment, loyalty, reliability, and stability of an individual (i.e., the individual’s trustworthiness) prior to authorizing access to the system or when elevating system access. The screening and rescreening activities reflect applicable federal laws, Executive Orders, directives, policies, regulations, and criteria established for the level of access required for the assigned position.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Personnel Screening (03.09.01) Personnel Screening not implemented | Medium | CUI Protection - Personnel Security |
| Personnel Screening (03.09.01) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Personnel Screening (03.09.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
