---
name: "External System Services (03.16.03)_external-system-services"
description: "Require the providers of external system services used for the processing, storage, or transmission of CUI to comply with the following security re..."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - external system services (03-16-03)
  - family-03.16
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

# External System Services (03.16.03) External System Services

## High-Level Description

**Family:** System and Services Acquisition
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Require the providers of external system services used for the processing, storage, or transmission of CUI to comply with the following security requirements: [organization-defined].
Define and document user roles and responsibilities with regard to external system services, including shared responsibilities with external service providers.
Implement processes, methods, and techniques to monitor security requirement compliance by external service providers on an ongoing basis.

## What to Check

- [ ] Verify External System Services (03.16.03) External System Services is implemented for CUI systems
- [ ] Review SSP documentation for External System Services (03.16.03)
- [ ] Validate CMMC Level 2 assessment objective for External System Services (03.16.03)
- [ ] Confirm POA&M addresses any gaps for External System Services (03.16.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for External System Services (03.16.03) implementation description and responsible parties.

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

Require the providers of external system services used for the processing, storage, or transmission of CUI to comply with the following security requirements: [organization-defined].
Define and document user roles and responsibilities with regard to external system services, including shared responsibilities with external service providers.
Implement processes, methods, and techniques to monitor security requirement compliance by external service providers on an ongoing basis.

### Supplemental Guidance

External system services are provided by external service providers. Organizations establish relationships with external service providers in a variety of ways, including through business partnerships, contracts, interagency agreements, lines of business arrangements, licensing agreements, joint ventures, and supply chain exchanges. The responsibility for managing risks from the use of external system services remains with the organization charged with protecting CUI. Service-level agreements define expectations of performance, describe measurable outcomes, and identify remedies, mitigations, and response requirements for instances of noncompliance. Information from external service providers regarding the specific functions, ports, protocols, and services used in the provision of such services can be useful when there is a need to understand the trade-offs involved in restricting certain functions and services or blocking certain ports and protocols. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.20) 03.01.20.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| External System Services (03.16.03) External System Services not implemented | Medium | CUI Protection - System and Services Acquisition |
| External System Services (03.16.03) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents External System Services (03.16.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
