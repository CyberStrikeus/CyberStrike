---
name: "Incident Response Plan (03.06.05)_incident-response-plan"
description: "Develop an incident response plan that: Provides the organization with a roadmap for implementing its incident response capability, Describes the stru"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - incident response plan (03-06-05)
  - family-03.06
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

# Incident Response Plan (03.06.05) Incident Response Plan

## High-Level Description

**Family:** Incident Response
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop an incident response plan that:
Provides the organization with a roadmap for implementing its incident response capability,
Describes the structure and organization of the incident response capability,
Provides a high-level approach for how the incident response capability fits into the overall organization,
Defines reportable incidents,
Addresses the sharing of incident information, and
Designates responsibilities to organizational entities, personnel, or roles.
Distribute copies of the incident response plan to designated incident response personnel (identified by name and/or by role) and organizational elements.
Update the incident response plan to address system and organizational changes or problems encountered during plan implementation, execution, or testing.
Protect the incident response plan from unauthorized disclosure.

## What to Check

- [ ] Verify Incident Response Plan (03.06.05) Incident Response Plan is implemented for CUI systems
- [ ] Review SSP documentation for Incident Response Plan (03.06.05)
- [ ] Validate CMMC Level 2 assessment objective for Incident Response Plan (03.06.05)
- [ ] Confirm POA&M addresses any gaps for Incident Response Plan (03.06.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Incident Response Plan (03.06.05) implementation description and responsible parties.

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

Develop an incident response plan that:
Provides the organization with a roadmap for implementing its incident response capability,
Describes the structure and organization of the incident response capability,
Provides a high-level approach for how the incident response capability fits into the overall organization,
Defines reportable incidents,
Addresses the sharing of incident information, and
Designates responsibilities to organizational entities, personnel, or roles.
Distribute copies of the incident response plan to designated incident response personnel (identified by name and/or by role) and organizational elements.
Update the incident response plan to address system and organizational changes or problems encountered during plan implementation, execution, or testing.
Protect the incident response plan from unauthorized disclosure.

### Supplemental Guidance

It is important that organizations develop and implement a coordinated approach to incident response. Organizational mission and business functions determine the structure of incident response capabilities. As part of the incident response capabilities, organizations consider the coordination and sharing of information with external organizations, including external service providers and other organizations involved in the supply chain.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Incident Response Plan (03.06.05) Incident Response Plan not implemented | Medium | CUI Protection - Incident Response |
| Incident Response Plan (03.06.05) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Incident Response Plan (03.06.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
