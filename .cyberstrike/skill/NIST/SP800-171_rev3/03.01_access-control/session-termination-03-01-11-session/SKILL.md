---
name: "Session Termination (03.01.11)_session-termination"
description: "Session Termination"
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - session termination (03-01-11)
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

# Session Termination (03.01.11) Session Termination

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Session Termination

## What to Check

- [ ] Verify Session Termination (03.01.11) Session Termination is implemented for CUI systems
- [ ] Review SSP documentation for Session Termination (03.01.11)
- [ ] Validate CMMC Level 2 assessment objective for Session Termination (03.01.11)
- [ ] Confirm POA&M addresses any gaps for Session Termination (03.01.11)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Session Termination (03.01.11) implementation description and responsible parties.

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

Implement Session Termination per NIST SP 800-171 Rev 3.

### Supplemental Guidance

This requirement addresses the termination of user-initiated logical sessions in contrast to the termination of network connections that are associated with communications sessions (i.e., disconnecting from the network) in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.13.09)03.13.09. A logical session is initiated whenever a user (or processes acting on behalf of a user) accesses a system. Logical sessions can be terminated (and thus terminate user access) without terminating network sessions. Session termination ends all system processes associated with a user’s logical session except those processes that are created by the user (i.e., session owner) to continue after the session is terminated. Conditions or trigger events that require automatic session termination can include organization-defined periods of user inactivity, time-of-day restrictions on system use, and targeted responses to certain types of incidents.

## Risk Assessment

| Finding                                                            | Severity | Impact                          |
| ------------------------------------------------------------------ | -------- | ------------------------------- |
| Session Termination (03.01.11) Session Termination not implemented | High     | CUI Protection - Access Control |
| Session Termination (03.01.11) partially implemented (POA&M)       | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Session Termination (03.01.11) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
