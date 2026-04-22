---
name: "Role-Based Training (03.02.02)_role-based-training"
description: "Provide role-based security training to organizational personnel: Before authorizing access to the system or CUI, before performing assigned duties, a"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - role-based training (03-02-02)
  - family-03.02
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

# Role-Based Training (03.02.02) Role-Based Training

## High-Level Description

**Family:** Awareness and Training
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Provide role-based security training to organizational personnel:
Before authorizing access to the system or CUI, before performing assigned duties, and [organization-defined] thereafter
When required by system changes or following [organization-defined].
Update role-based training content [organization-defined] and following [organization-defined].

## What to Check

- [ ] Verify Role-Based Training (03.02.02) Role-Based Training is implemented for CUI systems
- [ ] Review SSP documentation for Role-Based Training (03.02.02)
- [ ] Validate CMMC Level 2 assessment objective for Role-Based Training (03.02.02)
- [ ] Confirm POA&M addresses any gaps for Role-Based Training (03.02.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Role-Based Training (03.02.02) implementation description and responsible parties.

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

Provide role-based security training to organizational personnel:
Before authorizing access to the system or CUI, before performing assigned duties, and [organization-defined] thereafter
When required by system changes or following [organization-defined].
Update role-based training content [organization-defined] and following [organization-defined].

### Supplemental Guidance

Organizations determine the content and frequency of security training based on the assigned duties, roles, and responsibilities of individuals and the security requirements of the systems to which personnel have authorized access. In addition, organizations provide system developers, enterprise architects, security architects, software developers, systems integrators, acquisition/procurement officials, system and network administrators, personnel conducting configuration management and auditing activities, personnel performing independent verification and validation, security assessors, and personnel with access to system-level software with security-related technical training specifically tailored for their assigned duties. Comprehensive role-based training addresses management, operational, and technical roles and responsibilities that cover physical, personnel, and technical controls. Such training can include policies, procedures, tools, and artifacts for the security roles defined. Organizations also provide the training necessary for individuals to carry out their responsibilities related to operations and supply chain security within the context of organizational information security programs.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Role-Based Training (03.02.02) Role-Based Training not implemented | Medium | CUI Protection - Awareness and Training |
| Role-Based Training (03.02.02) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Role-Based Training (03.02.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
