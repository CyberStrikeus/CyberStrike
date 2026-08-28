---
name: "Physical Access Authorizations (03.10.01)_physical-access-authorizations"
description: "Develop, approve, and maintain a list of individuals with authorized access to the facility where the system resides."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - physical access authorizations (03-10-01)
  - family-03.10
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Physical Access Authorizations (03.10.01) Physical Access Authorizations

## High-Level Description

**Family:** Physical Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop, approve, and maintain a list of individuals with authorized access to the facility where the system resides.
Issue authorization credentials for facility access.
Review the facility access list [organization-defined].
Remove individuals from the facility access list when access is no longer required.

## What to Check

- [ ] Verify Physical Access Authorizations (03.10.01) Physical Access Authorizations is implemented for CUI systems
- [ ] Review SSP documentation for Physical Access Authorizations (03.10.01)
- [ ] Validate CMMC Level 2 assessment objective for Physical Access Authorizations (03.10.01)
- [ ] Confirm POA&M addresses any gaps for Physical Access Authorizations (03.10.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Physical Access Authorizations (03.10.01) implementation description and responsible parties.

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

Develop, approve, and maintain a list of individuals with authorized access to the facility where the system resides.
Issue authorization credentials for facility access.
Review the facility access list [organization-defined].
Remove individuals from the facility access list when access is no longer required.

### Supplemental Guidance

A facility can include one or more physical locations containing systems or system components that process, store, or transmit CUI. Physical access authorizations apply to employees and visitors. Individuals with permanent physical access authorization credentials are not considered visitors. Authorization credentials include identification badges, identification cards, and smart cards. Organizations determine the strength of the authorization credentials consistent with applicable laws, Executive Orders, directives, regulations, policies, standards, and guidelines. Physical access authorizations may not be necessary to access certain areas within facilities that are designated as publicly accessible.

## Risk Assessment

| Finding                                                                                  | Severity | Impact                               |
| ---------------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| Physical Access Authorizations (03.10.01) Physical Access Authorizations not implemented | Medium   | CUI Protection - Physical Protection |
| Physical Access Authorizations (03.10.01) partially implemented (POA&M)                  | Low      | CMMC certification risk              |

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

- [ ] SSP documents Physical Access Authorizations (03.10.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
