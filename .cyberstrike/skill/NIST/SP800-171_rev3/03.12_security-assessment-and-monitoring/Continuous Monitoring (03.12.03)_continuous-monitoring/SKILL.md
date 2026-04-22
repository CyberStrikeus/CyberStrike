---
name: "Continuous Monitoring (03.12.03)_continuous-monitoring"
description: "Continuous Monitoring"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - continuous monitoring (03-12-03)
  - family-03.12
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

# Continuous Monitoring (03.12.03) Continuous Monitoring

## High-Level Description

**Family:** Security Assessment and Monitoring
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Continuous Monitoring

## What to Check

- [ ] Verify Continuous Monitoring (03.12.03) Continuous Monitoring is implemented for CUI systems
- [ ] Review SSP documentation for Continuous Monitoring (03.12.03)
- [ ] Validate CMMC Level 2 assessment objective for Continuous Monitoring (03.12.03)
- [ ] Confirm POA&M addresses any gaps for Continuous Monitoring (03.12.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Continuous Monitoring (03.12.03) implementation description and responsible parties.

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

Implement Continuous Monitoring per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Continuous monitoring at the system level facilitates ongoing awareness of the system security posture to support risk management decisions. The terms continuous and ongoing imply that organizations assess and monitor their systems at a frequency that is sufficient to support risk-based decisions. Different types of security requirements may require different monitoring frequencies.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Continuous Monitoring (03.12.03) Continuous Monitoring not implemented | Medium | CUI Protection - Security Assessment and Monitoring |
| Continuous Monitoring (03.12.03) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Continuous Monitoring (03.12.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
