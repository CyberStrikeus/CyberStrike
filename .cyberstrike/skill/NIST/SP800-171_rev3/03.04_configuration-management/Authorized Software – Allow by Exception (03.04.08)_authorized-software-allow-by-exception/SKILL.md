---
name: "Authorized Software – Allow by Exception (03.04.08)_authorized-software-allow-by-exception"
description: "Identify software programs authorized to execute on the system."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - authorized software – allow by exception (03-04-08)
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

# Authorized Software – Allow by Exception (03.04.08) Authorized Software – Allow by Exception

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Identify software programs authorized to execute on the system.
Implement a deny-all, allow-by-exception policy for the execution of authorized software programs on the system.
Review and update the list of authorized software programs [organization-defined].

## What to Check

- [ ] Verify Authorized Software – Allow by Exception (03.04.08) Authorized Software – Allow by Exception is implemented for CUI systems
- [ ] Review SSP documentation for Authorized Software – Allow by Exception (03.04.08)
- [ ] Validate CMMC Level 2 assessment objective for Authorized Software – Allow by Exception (03.04.08)
- [ ] Confirm POA&M addresses any gaps for Authorized Software – Allow by Exception (03.04.08)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Authorized Software – Allow by Exception (03.04.08) implementation description and responsible parties.

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

Identify software programs authorized to execute on the system.
Implement a deny-all, allow-by-exception policy for the execution of authorized software programs on the system.
Review and update the list of authorized software programs [organization-defined].

### Supplemental Guidance

If provided with the necessary privileges, users can install software in organizational systems. To maintain control over the software installed, organizations identify permitted and prohibited actions regarding software installation. Permitted software installations include updates and security patches to existing software and downloading new applications from organization-approved “app stores.” The policies selected for governing user-installed software are organization-developed or provided by some external entity. Policy enforcement methods can include procedural methods and automated methods. Authorized software programs can be limited to specific versions or come from specific sources. To facilitate a comprehensive authorized software process and increase the strength of protection against attacks that bypass application-level authorized software, software programs may be decomposed into and monitored at different levels of detail. These levels include applications, application programming interfaces, application modules, scripts, system processes, system services, kernel functions, registries, drivers, and dynamic link libraries.

## Risk Assessment

| Finding                                                                                                      | Severity | Impact                                    |
| ------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------- |
| Authorized Software – Allow by Exception (03.04.08) Authorized Software – Allow by Exception not implemented | Medium   | CUI Protection - Configuration Management |
| Authorized Software – Allow by Exception (03.04.08) partially implemented (POA&M)                            | Low      | CMMC certification risk                   |

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

- [ ] SSP documents Authorized Software – Allow by Exception (03.04.08) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
