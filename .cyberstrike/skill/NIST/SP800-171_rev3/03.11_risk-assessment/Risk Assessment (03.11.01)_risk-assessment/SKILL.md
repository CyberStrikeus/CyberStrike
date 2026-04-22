---
name: "Risk Assessment (03.11.01)_risk-assessment"
description: "Assess the risk (including supply chain risk) of unauthorized disclosure resulting from the processing, storage, or transmission of CUI."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - risk assessment (03-11-01)
  - family-03.11
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Risk Assessment (03.11.01) Risk Assessment

## High-Level Description

**Family:** Risk Assessment
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Assess the risk (including supply chain risk) of unauthorized disclosure resulting from the processing, storage, or transmission of CUI.
Update risk assessments [organization-defined].

## What to Check

- [ ] Verify Risk Assessment (03.11.01) Risk Assessment is implemented for CUI systems
- [ ] Review SSP documentation for Risk Assessment (03.11.01)
- [ ] Validate CMMC Level 2 assessment objective for Risk Assessment (03.11.01)
- [ ] Confirm POA&M addresses any gaps for Risk Assessment (03.11.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Risk Assessment (03.11.01) implementation description and responsible parties.

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

Assess the risk (including supply chain risk) of unauthorized disclosure resulting from the processing, storage, or transmission of CUI.
Update risk assessments [organization-defined].

### Supplemental Guidance

Establishing the system boundary is a prerequisite to assessing the risk of the unauthorized disclosure of CUI. Risk assessments consider threats, vulnerabilities, likelihood, and adverse impacts to organizational operations and assets based on the operation and use of the system and the unauthorized disclosure of CUI. Risk assessments also consider risks from external parties (e.g., contractors operating systems on behalf of the organization, service providers, individuals accessing systems, and outsourcing entities). Risk assessments can be conducted at the organization level, the mission or business process level, or the system level and at any phase in the system development life cycle. Risk assessments include supply chain-related risks associated with suppliers or contractors and the system, system component, or system service that they provide.

## Risk Assessment

| Finding                                                    | Severity | Impact                           |
| ---------------------------------------------------------- | -------- | -------------------------------- |
| Risk Assessment (03.11.01) Risk Assessment not implemented | Medium   | CUI Protection - Risk Assessment |
| Risk Assessment (03.11.01) partially implemented (POA&M)   | Low      | CMMC certification risk          |

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

- [ ] SSP documents Risk Assessment (03.11.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
