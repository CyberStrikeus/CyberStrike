---
name: "Plan of Action and Milestones (03.12.02)_plan-of-action-and-milestones"
description: "Develop a plan of action and milestones for the system: To document the planned remediation actions to correct weaknesses or deficiencies noted during"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - plan of action and milestones (03-12-02)
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

# Plan of Action and Milestones (03.12.02) Plan of Action and Milestones

## High-Level Description

**Family:** Security Assessment and Monitoring
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop a plan of action and milestones for the system:
To document the planned remediation actions to correct weaknesses or deficiencies noted during security assessments and
To reduce or eliminate known system vulnerabilities.
Update the existing plan of action and milestones based on the findings from:
Security assessments,
Audits or reviews, and
Continuous monitoring activities.

## What to Check

- [ ] Verify Plan of Action and Milestones (03.12.02) Plan of Action and Milestones is implemented for CUI systems
- [ ] Review SSP documentation for Plan of Action and Milestones (03.12.02)
- [ ] Validate CMMC Level 2 assessment objective for Plan of Action and Milestones (03.12.02)
- [ ] Confirm POA&M addresses any gaps for Plan of Action and Milestones (03.12.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Plan of Action and Milestones (03.12.02) implementation description and responsible parties.

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

Develop a plan of action and milestones for the system:
To document the planned remediation actions to correct weaknesses or deficiencies noted during security assessments and
To reduce or eliminate known system vulnerabilities.
Update the existing plan of action and milestones based on the findings from:
Security assessments,
Audits or reviews, and
Continuous monitoring activities.

### Supplemental Guidance

Plans of action and milestones (POAMs) are important documents in organizational security programs. Organizations use POAMs to describe how unsatisfied security requirements will be met and how planned mitigations will be implemented. Organizations can document system security plans and POAMs as separate or combined documents in any format. Federal agencies may consider system security plans and POAMs as inputs to risk-based decisions on whether to process, store, or transmit CUI on a system hosted by a nonfederal organization.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Plan of Action and Milestones (03.12.02) Plan of Action and Milestones not implemented | Medium | CUI Protection - Security Assessment and Monitoring |
| Plan of Action and Milestones (03.12.02) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Plan of Action and Milestones (03.12.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
