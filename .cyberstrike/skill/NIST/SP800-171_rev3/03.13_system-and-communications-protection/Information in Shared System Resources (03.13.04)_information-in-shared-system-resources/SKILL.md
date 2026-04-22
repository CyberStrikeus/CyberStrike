---
name: "Information in Shared System Resources (03.13.04)_information-in-shared-system-resources"
description: "Information in Shared System Resources"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - information in shared system resources (03-13-04)
  - family-03.13
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
  - network
cwe_ids:
  - CWE-311
chains_with: []
prerequisites: []
severity_boost: {}
---

# Information in Shared System Resources (03.13.04) Information in Shared System Resources

## High-Level Description

**Family:** System and Communications Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Information in Shared System Resources

## What to Check

- [ ] Verify Information in Shared System Resources (03.13.04) Information in Shared System Resources is implemented for CUI systems
- [ ] Review SSP documentation for Information in Shared System Resources (03.13.04)
- [ ] Validate CMMC Level 2 assessment objective for Information in Shared System Resources (03.13.04)
- [ ] Confirm POA&M addresses any gaps for Information in Shared System Resources (03.13.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Information in Shared System Resources (03.13.04) implementation description and responsible parties.

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

Implement Information in Shared System Resources per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Preventing unauthorized and unintended information transfer via shared system resources stops information produced by the actions of prior users or roles (or actions of processes acting on behalf of prior users or roles) from being available to current users or roles (or current processes acting on behalf of current users or roles) that obtain access to shared system resources after those resources have been released back to the system. Information in shared system resources also applies to encrypted representations of information. In other contexts, the control of information in shared system resources is referred to as object reuse and residual information protection. Information in shared system resources does not address information remanence, which refers to the residual representation of data that has been nominally deleted, covert channels (including storage and timing channels) in which shared system resources are manipulated to violate information flow restrictions, or components within systems for which there are only single users or roles.

## Risk Assessment

| Finding                                                                                                  | Severity | Impact                                                |
| -------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Information in Shared System Resources (03.13.04) Information in Shared System Resources not implemented | High     | CUI Protection - System and Communications Protection |
| Information in Shared System Resources (03.13.04) partially implemented (POA&M)                          | Medium   | CMMC certification risk                               |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-311 | Missing Encryption of Sensitive Data |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Information in Shared System Resources (03.13.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
