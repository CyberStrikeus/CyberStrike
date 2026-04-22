---
name: "Information Exchange (03.12.05)_information-exchange"
description: "Approve and manage the exchange of CUI between the system and other systems using [organization-defined]."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - information exchange (03-12-05)
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

# Information Exchange (03.12.05) Information Exchange

## High-Level Description

**Family:** Security Assessment and Monitoring
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Approve and manage the exchange of CUI between the system and other systems using [organization-defined].
Document interface characteristics, security requirements, and responsibilities for each system as part of the exchange agreements.
Review and update the exchange agreements [organization-defined].

## What to Check

- [ ] Verify Information Exchange (03.12.05) Information Exchange is implemented for CUI systems
- [ ] Review SSP documentation for Information Exchange (03.12.05)
- [ ] Validate CMMC Level 2 assessment objective for Information Exchange (03.12.05)
- [ ] Confirm POA&M addresses any gaps for Information Exchange (03.12.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Information Exchange (03.12.05) implementation description and responsible parties.

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

Approve and manage the exchange of CUI between the system and other systems using [organization-defined].
Document interface characteristics, security requirements, and responsibilities for each system as part of the exchange agreements.
Review and update the exchange agreements [organization-defined].

### Supplemental Guidance

Information exchange applies to information exchanges between two or more systems, both internal and external to the organization. Organizations consider the risks related to new or increased threats that may be introduced when systems exchange information with other systems that may have different security requirements or policies. The types of agreements selected are based on factors such as the relationship between the organizations exchanging information (e.g., government to government, business to business, government to business, government or business, or government or business to individual) and the level of access to the organizational system by users of the other system. The types of agreements can include information exchange security agreements, interconnection security agreements, memoranda of understanding or agreement, service-level agreements, or other types of agreements. Organizations may incorporate agreement information into formal contracts, especially for information exchanges established between federal agencies and nonfederal organizations (e.g., service providers, contractors, system developers, and system integrators). The types of information contained in exchange agreements include the interface characteristics, security requirements, controls, and responsibilities for each system.

## Risk Assessment

| Finding                                                              | Severity | Impact                                              |
| -------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| Information Exchange (03.12.05) Information Exchange not implemented | Medium   | CUI Protection - Security Assessment and Monitoring |
| Information Exchange (03.12.05) partially implemented (POA&M)        | Low      | CMMC certification risk                             |

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

- [ ] SSP documents Information Exchange (03.12.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
