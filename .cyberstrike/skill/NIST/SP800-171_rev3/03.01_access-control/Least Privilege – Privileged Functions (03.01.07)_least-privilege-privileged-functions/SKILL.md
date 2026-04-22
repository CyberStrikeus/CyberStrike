---
name: "Least Privilege – Privileged Functions (03.01.07)_least-privilege-privileged-functions"
description: "Prevent non-privileged users from executing privileged functions."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - least privilege – privileged functions (03-01-07)
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
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Least Privilege – Privileged Functions (03.01.07) Least Privilege – Privileged Functions

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Prevent non-privileged users from executing privileged functions.
Log the execution of privileged functions.

## What to Check

- [ ] Verify Least Privilege – Privileged Functions (03.01.07) Least Privilege – Privileged Functions is implemented for CUI systems
- [ ] Review SSP documentation for Least Privilege – Privileged Functions (03.01.07)
- [ ] Validate CMMC Level 2 assessment objective for Least Privilege – Privileged Functions (03.01.07)
- [ ] Confirm POA&M addresses any gaps for Least Privilege – Privileged Functions (03.01.07)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Least Privilege – Privileged Functions (03.01.07) implementation description and responsible parties.

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

Prevent non-privileged users from executing privileged functions.
Log the execution of privileged functions.

### Supplemental Guidance

Privileged functions include establishing system accounts, performing system integrity checks, conducting patching operations, changing system configuration settings, or administering cryptographic key management activities. Non-privileged users do not possess the authorizations to execute privileged functions. Bypassing intrusion detection and prevention mechanisms or malicious code protection mechanisms are examples of privileged functions that require protection from non-privileged users. This requirement represents a condition achieved by the definition of authorized privileges in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.01)03.01.01 and privilege enforcement in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.02)03.01.02. The misuse of privileged functions — whether intentionally or unintentionally by authorized users or by unauthorized external entities that have compromised system accounts — is a serious and ongoing concern that can have significant adverse impacts on organizations. Logging the use of privileged functions is one way to detect such misuse and mitigate risks from advanced persistent threats and insider threats.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Least Privilege – Privileged Functions (03.01.07) Least Privilege – Privileged Functions not implemented | High | CUI Protection - Access Control |
| Least Privilege – Privileged Functions (03.01.07) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Least Privilege – Privileged Functions (03.01.07) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
