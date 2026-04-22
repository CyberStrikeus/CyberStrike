---
name: "Password Management (03.05.07)_password-management"
description: "Maintain a list of commonly-used, expected, or compromised passwords, and update the list [organization-defined] and when organizational passwords ..."
category: "authentication"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - password management (03-05-07)
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
chains_with: []
prerequisites: []
severity_boost: {}
---

# Password Management (03.05.07) Password Management

## High-Level Description

**Family:** Identification and Authentication
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Maintain a list of commonly-used, expected, or compromised passwords, and update the list [organization-defined] and when organizational passwords are suspected to have been compromised.
Verify that passwords are not found on the list of commonly used, expected, or compromised passwords when users create or update passwords.
Transmit passwords only over cryptographically protected channels.
Store passwords in a cryptographically protected form.
Select a new password upon first use after account recovery.
Enforce the following composition and complexity rules for passwords: [organization-defined].

## What to Check

- [ ] Verify Password Management (03.05.07) Password Management is implemented for CUI systems
- [ ] Review SSP documentation for Password Management (03.05.07)
- [ ] Validate CMMC Level 2 assessment objective for Password Management (03.05.07)
- [ ] Confirm POA&M addresses any gaps for Password Management (03.05.07)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Password Management (03.05.07) implementation description and responsible parties.

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

Maintain a list of commonly-used, expected, or compromised passwords, and update the list [organization-defined] and when organizational passwords are suspected to have been compromised.
Verify that passwords are not found on the list of commonly used, expected, or compromised passwords when users create or update passwords.
Transmit passwords only over cryptographically protected channels.
Store passwords in a cryptographically protected form.
Select a new password upon first use after account recovery.
Enforce the following composition and complexity rules for passwords: [organization-defined].

### Supplemental Guidance

Password-based authentication applies to passwords used in single-factor or multi-factor authentication. Long passwords or passphrases are preferable to shorter passwords. Enforced composition rules provide marginal security benefits while decreasing usability. However, organizations may choose to establish and enforce certain rules for password generation (e.g., minimum character length) under certain circumstances. For example, account recovery can occur when a password is forgotten. Cryptographically protected passwords include salted one-way cryptographic hashes of passwords. The list of commonly used, compromised, or expected passwords includes passwords obtained from previous breach corpuses, dictionary words, and repetitive or sequential characters. The list includes context-specific words, such as the name of the service, username, and derivatives thereof. Changing temporary passwords to permanent passwords immediately after system logon ensures that the necessary strength of the authentication mechanism is implemented at the earliest opportunity and reduces susceptibility to authenticator compromises. Long passwords and passphrases can be used to increase the complexity of passwords.

## Risk Assessment

| Finding                                                            | Severity | Impact                                             |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| Password Management (03.05.07) Password Management not implemented | High     | CUI Protection - Identification and Authentication |
| Password Management (03.05.07) partially implemented (POA&M)       | Medium   | CMMC certification risk                            |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-287 | Improper Authentication |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Password Management (03.05.07) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
