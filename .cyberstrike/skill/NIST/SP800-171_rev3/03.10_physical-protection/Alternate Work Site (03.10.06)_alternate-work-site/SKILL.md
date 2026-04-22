---
name: "Alternate Work Site (03.10.06)_alternate-work-site"
description: "Determine alternate work sites allowed for use by employees."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - alternate work site (03-10-06)
  - family-03.10
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

# Alternate Work Site (03.10.06) Alternate Work Site

## High-Level Description

**Family:** Physical Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Determine alternate work sites allowed for use by employees.
Employ the following security requirements at alternate work sites: [organization-defined].

## What to Check

- [ ] Verify Alternate Work Site (03.10.06) Alternate Work Site is implemented for CUI systems
- [ ] Review SSP documentation for Alternate Work Site (03.10.06)
- [ ] Validate CMMC Level 2 assessment objective for Alternate Work Site (03.10.06)
- [ ] Confirm POA&M addresses any gaps for Alternate Work Site (03.10.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Alternate Work Site (03.10.06) implementation description and responsible parties.

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

Determine alternate work sites allowed for use by employees.
Employ the following security requirements at alternate work sites: [organization-defined].

### Supplemental Guidance

Alternate work sites include the private residences of employees or other facilities designated by the organization. Alternate work sites can provide readily available alternate locations during contingency operations. Organizations can define different security requirements for specific alternate work sites or types of sites, depending on the work-related activities conducted at the sites. Assessing the effectiveness of the requirements and providing a means to communicate incidents at alternate work sites supports the contingency planning activities of organizations.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Alternate Work Site (03.10.06) Alternate Work Site not implemented | Medium | CUI Protection - Physical Protection |
| Alternate Work Site (03.10.06) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Alternate Work Site (03.10.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
