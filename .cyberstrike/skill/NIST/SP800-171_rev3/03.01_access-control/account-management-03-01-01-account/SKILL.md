---
name: "Account Management (03.01.01)_account-management"
description: "Define the types of system accounts allowed and prohibited."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - account management (03-01-01)
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

# Account Management (03.01.01) Account Management

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Define the types of system accounts allowed and prohibited.
Create, enable, modify, disable, and remove system accounts in accordance with policy, procedures, prerequisites, and criteria.
Specify:
Authorized users of the system,
Group and role membership, and
Access authorizations (i.e., privileges) for each account.
Authorize access to the system based on:
A valid access authorization and
Intended system usage.
Monitor the use of system accounts.
Disable system accounts when:
The accounts have expired,
The accounts have been inactive for [organization-defined],
The accounts are no longer associated with a user or individual,
The accounts are in violation of organizational policy, or
Significant risks associated with individuals are discovered.
Notify account managers and designated personnel or roles within:
[organization-defined] when accounts are no longer required.
[organization-defined] when users are terminated or transferred.
[organization-defined] when system usage or the need-to-know changes for an individual.
Require that users log out of the system after [organization-defined] of expected inactivity or when [organization-defined].

## What to Check

- [ ] Verify Account Management (03.01.01) Account Management is implemented for CUI systems
- [ ] Review SSP documentation for Account Management (03.01.01)
- [ ] Validate CMMC Level 2 assessment objective for Account Management (03.01.01)
- [ ] Confirm POA&M addresses any gaps for Account Management (03.01.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Account Management (03.01.01) implementation description and responsible parties.

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

Define the types of system accounts allowed and prohibited.
Create, enable, modify, disable, and remove system accounts in accordance with policy, procedures, prerequisites, and criteria.
Specify:
Authorized users of the system,
Group and role membership, and
Access authorizations (i.e., privileges) for each account.
Authorize access to the system based on:
A valid access authorization and
Intended system usage.
Monitor the use of system accounts.
Disable system accounts when:
The accounts have expired,
The accounts have been inactive for [organization-defined],
The accounts are no longer associated with a user or individual,
The accounts are in violation of organizational policy, or
Significant risks associated with individuals are discovered.
Notify account managers and designated personnel or roles within:
[organization-defined] when accounts are no longer required.
[organization-defined] when users are terminated or transferred.
[organization-defined] when system usage or the need-to-know changes for an individual.
Require that users log out of the system after [organization-defined] of expected inactivity or when [organization-defined].

### Supplemental Guidance

This requirement focuses on account management for systems and applications. The definition and enforcement of access authorizations other than those determined by account type (e.g., privileged access, non-privileged access) are addressed in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.02)03.01.02. System account types include individual, group, temporary, system, guest, anonymous, emergency, developer, and service. Users who require administrative privileges on system accounts receive additional scrutiny by personnel responsible for approving such accounts and privileged access. Types of accounts that organizations may prohibit due to increased risk include group, emergency, guest, anonymous, and temporary. Organizations may choose to define access privileges or other attributes by account, type of account, or a combination of both. Other attributes required for authorizing access include restrictions on the time of day, day of the week, and point of origin. When defining other system account attributes, organizations consider system requirements (e.g., system upgrades, scheduled maintenance) and mission and business requirements (e.g., time zone differences, remote access to facilitate travel requirements). Users who pose a significant security risk include individuals for whom reliable evidence indicates either the intention to use authorized access to the system to cause harm or that adversaries will cause harm through them. Close coordination among mission and business owners, system administrators, human resource managers, and legal staff is essential when disabling system accounts for high-risk individuals. Time periods for the notification of organizational personnel or roles may vary. Inactivity logout is behavior- or policy-based and requires users to take physical action to log out when they are expecting inactivity longer than the defined period. Automatic enforcement of inactivity logout is addressed by [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.10) 03.01.10.

## Risk Assessment

| Finding                                                          | Severity | Impact                          |
| ---------------------------------------------------------------- | -------- | ------------------------------- |
| Account Management (03.01.01) Account Management not implemented | High     | CUI Protection - Access Control |
| Account Management (03.01.01) partially implemented (POA&M)      | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Account Management (03.01.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
