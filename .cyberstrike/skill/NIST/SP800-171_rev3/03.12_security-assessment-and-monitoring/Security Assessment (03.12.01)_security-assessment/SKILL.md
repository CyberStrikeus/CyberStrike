---
name: "Security Assessment (03.12.01)_security-assessment"
description: "Security Assessment"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - security assessment (03-12-01)
  - family-03.12
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Security Assessment (03.12.01) Security Assessment

## High-Level Description

**Family:** Security Assessment and Monitoring
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Security Assessment

## What to Check

- [ ] Verify Security Assessment (03.12.01) Security Assessment is implemented for CUI systems
- [ ] Review SSP documentation for Security Assessment (03.12.01)
- [ ] Validate CMMC Level 2 assessment objective for Security Assessment (03.12.01)
- [ ] Confirm POA&M addresses any gaps for Security Assessment (03.12.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Security Assessment (03.12.01) implementation description and responsible parties.

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

Implement Security Assessment per NIST SP 800-171 Rev 3.

### Supplemental Guidance

By assessing the security requirements, organizations determine whether the necessary safeguards and countermeasures are implemented correctly, operating as intended, and producing the desired outcome. Security assessments identify weaknesses in the system and provide the essential information needed to make risk-based decisions. Security assessment reports document assessment results in sufficient detail as deemed necessary by the organization to determine the accuracy and completeness of the reports. Security assessment results are provided to the individuals or roles appropriate for the types of assessments being conducted.

## Risk Assessment

| Finding                                                            | Severity | Impact                                              |
| ------------------------------------------------------------------ | -------- | --------------------------------------------------- |
| Security Assessment (03.12.01) Security Assessment not implemented | Medium   | CUI Protection - Security Assessment and Monitoring |
| Security Assessment (03.12.01) partially implemented (POA&M)       | Low      | CMMC certification risk                             |

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

- [ ] SSP documents Security Assessment (03.12.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
