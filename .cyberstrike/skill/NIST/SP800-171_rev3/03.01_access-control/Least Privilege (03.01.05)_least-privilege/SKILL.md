---
name: "Least Privilege (03.01.05)_least-privilege"
description: "Allow only authorized system access for users (or processes acting on behalf of users) that is necessary to accomplish assigned organizational tasks."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - least privilege (03-01-05)
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

# Least Privilege (03.01.05) Least Privilege

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Allow only authorized system access for users (or processes acting on behalf of users) that is necessary to accomplish assigned organizational tasks.
Authorize access to [organization-defined] and [organization-defined].
Review the privileges assigned to roles or classes of users [organization-defined] to validate the need for such privileges.
Reassign or remove privileges, as necessary.

## What to Check

- [ ] Verify Least Privilege (03.01.05) Least Privilege is implemented for CUI systems
- [ ] Review SSP documentation for Least Privilege (03.01.05)
- [ ] Validate CMMC Level 2 assessment objective for Least Privilege (03.01.05)
- [ ] Confirm POA&M addresses any gaps for Least Privilege (03.01.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Least Privilege (03.01.05) implementation description and responsible parties.

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

Allow only authorized system access for users (or processes acting on behalf of users) that is necessary to accomplish assigned organizational tasks.
Authorize access to [organization-defined] and [organization-defined].
Review the privileges assigned to roles or classes of users [organization-defined] to validate the need for such privileges.
Reassign or remove privileges, as necessary.

### Supplemental Guidance

Organizations employ the principle of least privilege for specific duties and authorized access for users and system processes. Least privilege is applied to the development, implementation, and operation of the system. Organizations consider creating additional processes, roles, and system accounts to achieve least privilege. Security functions include establishing system accounts and assigning privileges, installing software, configuring access authorizations, configuring settings for events to be audited, establishing vulnerability scanning parameters, establishing intrusion detection parameters, and managing audit information. Security-relevant information includes threat and vulnerability information, filtering rules for routers or firewalls, configuration parameters for security services, security architecture, cryptographic key management information, access control lists, and audit information.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Least Privilege (03.01.05) Least Privilege not implemented | High | CUI Protection - Access Control |
| Least Privilege (03.01.05) partially implemented (POA&M) | Medium | CMMC certification risk |

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

- [ ] SSP documents Least Privilege (03.01.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
