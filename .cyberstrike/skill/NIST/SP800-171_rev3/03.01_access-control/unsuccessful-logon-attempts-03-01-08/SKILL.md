---
name: "Unsuccessful Logon Attempts (03.01.08)_unsuccessful-logon-attempts"
description: "Enforce a limit of [organization-defined] consecutive invalid logon attempts by a user during a [organization-defined]."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - unsuccessful logon attempts (03-01-08)
  - family-03.01
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# Unsuccessful Logon Attempts (03.01.08) Unsuccessful Logon Attempts

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Enforce a limit of [organization-defined] consecutive invalid logon attempts by a user during a [organization-defined].
Automatically [organization-defined] when the maximum number of unsuccessful attempts is exceeded.

## What to Check

- [ ] Verify Unsuccessful Logon Attempts (03.01.08) Unsuccessful Logon Attempts is implemented for CUI systems
- [ ] Review SSP documentation for Unsuccessful Logon Attempts (03.01.08)
- [ ] Validate CMMC Level 2 assessment objective for Unsuccessful Logon Attempts (03.01.08)
- [ ] Confirm POA&M addresses any gaps for Unsuccessful Logon Attempts (03.01.08)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Unsuccessful Logon Attempts (03.01.08) implementation description and responsible parties.

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

Enforce a limit of [organization-defined] consecutive invalid logon attempts by a user during a [organization-defined].
Automatically [organization-defined] when the maximum number of unsuccessful attempts is exceeded.

### Supplemental Guidance

Due to the potential for denial of service, automatic system lockouts are in most cases, temporary and automatically release after a predetermined time period established by the organization (i.e., using a delay algorithm). Organizations may employ different delay algorithms for different system components based on the capabilities of the respective components. Responses to unsuccessful system logon attempts may be implemented at the system and application levels. Organization-defined actions that may be taken include prompting the user to answer a secret question in addition to the username and password, invoking a lockdown mode with limited user capabilities (instead of a full lockout), allowing users to only logon from specified Internet Protocol (IP) addresses, requiring a CAPTCHA to prevent automated attacks, or applying user profiles, such as location, time of day, IP address, device, or Media Access Control (MAC) address.

## Risk Assessment

| Finding                                                                            | Severity | Impact                          |
| ---------------------------------------------------------------------------------- | -------- | ------------------------------- |
| Unsuccessful Logon Attempts (03.01.08) Unsuccessful Logon Attempts not implemented | High     | CUI Protection - Access Control |
| Unsuccessful Logon Attempts (03.01.08) partially implemented (POA&M)               | Medium   | CMMC certification risk         |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Unsuccessful Logon Attempts (03.01.08) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
