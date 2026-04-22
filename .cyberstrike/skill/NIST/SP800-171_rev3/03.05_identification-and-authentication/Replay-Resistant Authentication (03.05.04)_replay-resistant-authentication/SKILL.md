---
name: "Replay-Resistant Authentication (03.05.04)_replay-resistant-authentication"
description: "Replay-Resistant Authentication"
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - replay-resistant authentication (03-05-04)
  - family-03.05
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - active-directory
  - linux
  - windows
cwe_ids:
  - CWE-287
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Replay-Resistant Authentication (03.05.04) Replay-Resistant Authentication

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Replay-Resistant Authentication

## What to Check

- [ ] Verify Replay-Resistant Authentication (03.05.04) Replay-Resistant Authentication is implemented for CUI systems
- [ ] Review SSP documentation for Replay-Resistant Authentication (03.05.04)
- [ ] Validate CMMC Level 2 assessment objective for Replay-Resistant Authentication (03.05.04)
- [ ] Confirm POA&M addresses any gaps for Replay-Resistant Authentication (03.05.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Replay-Resistant Authentication (03.05.04) implementation description and responsible parties.

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

Implement Replay-Resistant Authentication per NIST SP 800-171 Rev 3.

### Supplemental Guidance

Authentication processes resist replay attacks if it is impractical to successfully authenticate by recording or replaying previous authentication messages. Replay-resistant techniques include protocols that use nonces or challenges, such as time synchronous or challenge-response one-time authenticators.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Replay-Resistant Authentication (03.05.04) Replay-Resistant Authentication not implemented | High | CUI Protection - Identification and Authentication |
| Replay-Resistant Authentication (03.05.04) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-287 | Improper Authentication |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Replay-Resistant Authentication (03.05.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
