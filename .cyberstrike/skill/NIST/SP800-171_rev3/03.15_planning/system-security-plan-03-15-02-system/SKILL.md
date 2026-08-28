---
name: "System Security Plan (03.15.02)_system-security-plan"
description: "Develop a system security plan that: Defines the constituent system components; Identifies the information types processed, stored, and transmitted by"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - system security plan (03-15-02)
  - family-03.15
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# System Security Plan (03.15.02) System Security Plan

## High-Level Description

**Family:** Planning
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop a system security plan that:
Defines the constituent system components;
Identifies the information types processed, stored, and transmitted by the system;
Describes specific threats to the system that are of concern to the organization;
Describes the operational environment for the system and any dependencies on or connections to other systems or system components;
Provides an overview of the security requirements for the system;
Describes the safeguards in place or planned for meeting the security requirements;
Identifies individuals that fulfill system roles and responsibilities; and
Includes other relevant information necessary for the protection of CUI.
Review and update the system security plan [organization-defined].
Protect the system security plan from unauthorized disclosure.

## What to Check

- [ ] Verify System Security Plan (03.15.02) System Security Plan is implemented for CUI systems
- [ ] Review SSP documentation for System Security Plan (03.15.02)
- [ ] Validate CMMC Level 2 assessment objective for System Security Plan (03.15.02)
- [ ] Confirm POA&M addresses any gaps for System Security Plan (03.15.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for System Security Plan (03.15.02) implementation description and responsible parties.

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

Develop a system security plan that:
Defines the constituent system components;
Identifies the information types processed, stored, and transmitted by the system;
Describes specific threats to the system that are of concern to the organization;
Describes the operational environment for the system and any dependencies on or connections to other systems or system components;
Provides an overview of the security requirements for the system;
Describes the safeguards in place or planned for meeting the security requirements;
Identifies individuals that fulfill system roles and responsibilities; and
Includes other relevant information necessary for the protection of CUI.
Review and update the system security plan [organization-defined].
Protect the system security plan from unauthorized disclosure.

### Supplemental Guidance

System security plans provide key characteristics of the system that is processing, storing, and transmitting CUI and how the system and information are protected. System security plans contain sufficient information to enable a design and implementation that are unambiguously compliant with the intent of the plans and the subsequent determinations of risk if the plan is implemented as intended. System security plans can be a collection of documents, including documents that already exist. Effective system security plans reference policies, procedures, and documents (e.g., design specifications) that provide additional detailed information. This reduces the documentation requirements associated with security programs and maintains security information in other established management or operational areas related to enterprise architecture, the system development life cycle, systems engineering, and acquisition.

## Risk Assessment

| Finding                                                              | Severity | Impact                    |
| -------------------------------------------------------------------- | -------- | ------------------------- |
| System Security Plan (03.15.02) System Security Plan not implemented | Medium   | CUI Protection - Planning |
| System Security Plan (03.15.02) partially implemented (POA&M)        | Low      | CMMC certification risk   |

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

- [ ] SSP documents System Security Plan (03.15.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
