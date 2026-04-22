---
name: "Least Privilege – Privileged Accounts (03.01.06)_least-privilege-privileged-accounts"
description: "Restrict privileged accounts on the system to [organization-defined].."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - least privilege – privileged accounts (03-01-06)
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

# Least Privilege – Privileged Accounts (03.01.06) Least Privilege – Privileged Accounts

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Restrict privileged accounts on the system to [organization-defined]..
Require that users (or roles) with privileged accounts use non-privileged accounts when accessing non-security functions or non-security information.

## What to Check

- [ ] Verify Least Privilege – Privileged Accounts (03.01.06) Least Privilege – Privileged Accounts is implemented for CUI systems
- [ ] Review SSP documentation for Least Privilege – Privileged Accounts (03.01.06)
- [ ] Validate CMMC Level 2 assessment objective for Least Privilege – Privileged Accounts (03.01.06)
- [ ] Confirm POA&M addresses any gaps for Least Privilege – Privileged Accounts (03.01.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Least Privilege – Privileged Accounts (03.01.06) implementation description and responsible parties.

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

Restrict privileged accounts on the system to [organization-defined]..
Require that users (or roles) with privileged accounts use non-privileged accounts when accessing non-security functions or non-security information.

### Supplemental Guidance

Privileged accounts refer to accounts that are granted elevated privileges to access resources (including security functions or security-relevant information) that are otherwise restricted for non-privileged accounts. These accounts are typically described as system administrator or super user accounts. For example, a privileged account is often required in order to perform privileged functions such as executing commands that could modify system behavior. Restricting privileged accounts to specific personnel or roles ensures that only those authorized users can access and manipulate security functions or security-relevant information. Requiring the use of non-privileged accounts when such access is not needed can limit unauthorized access to and manipulation of security functions or security-relevant information.

## Risk Assessment

| Finding                                                                                                | Severity | Impact                          |
| ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------- |
| Least Privilege – Privileged Accounts (03.01.06) Least Privilege – Privileged Accounts not implemented | High     | CUI Protection - Access Control |
| Least Privilege – Privileged Accounts (03.01.06) partially implemented (POA&M)                         | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Least Privilege – Privileged Accounts (03.01.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
