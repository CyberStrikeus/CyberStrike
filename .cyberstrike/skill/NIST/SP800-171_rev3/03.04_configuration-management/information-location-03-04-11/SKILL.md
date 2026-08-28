---
name: "Information Location (03.04.11)_information-location"
description: "Identify and document the location of CUI and the system components on which the information is processed and stored."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - information location (03-04-11)
  - family-03.04
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with: []
prerequisites: []
severity_boost: {}
---

# Information Location (03.04.11) Information Location

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Identify and document the location of CUI and the system components on which the information is processed and stored.
Document changes to the system or system component location where CUI is processed and stored.

## What to Check

- [ ] Verify Information Location (03.04.11) Information Location is implemented for CUI systems
- [ ] Review SSP documentation for Information Location (03.04.11)
- [ ] Validate CMMC Level 2 assessment objective for Information Location (03.04.11)
- [ ] Confirm POA&M addresses any gaps for Information Location (03.04.11)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Information Location (03.04.11) implementation description and responsible parties.

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

Identify and document the location of CUI and the system components on which the information is processed and stored.
Document changes to the system or system component location where CUI is processed and stored.

### Supplemental Guidance

Information location addresses the need to understand the specific system components where CUI is being processed and stored and the users who have access to CUI so that appropriate protection mechanisms can be provided, including information flow controls, access controls, and information management.

## Risk Assessment

| Finding                                                              | Severity | Impact                                    |
| -------------------------------------------------------------------- | -------- | ----------------------------------------- |
| Information Location (03.04.11) Information Location not implemented | Medium   | CUI Protection - Configuration Management |
| Information Location (03.04.11) partially implemented (POA&M)        | Low      | CMMC certification risk                   |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Information Location (03.04.11) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
