---
name: "Use of External Systems (03.01.20)_use-of-external-systems"
description: "Prohibit the use of external systems unless the systems are specifically authorized."
category: "authorization"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - use of external systems (03-01-20)
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

# Use of External Systems (03.01.20) Use of External Systems

## High-Level Description

**Family:** Access Control
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Prohibit the use of external systems unless the systems are specifically authorized.
Establish the following security requirements to be satisfied on external systems prior to allowing use of or access to those systems by authorized individuals: [organization-defined].
Permit authorized individuals to use external systems to access the organizational system or to process, store, or transmit CUI only after:
Verifying that the security requirements on the external systems as specified in the organization’s system security plans have been satisfied and
Retaining approved system connection or processing agreements with the organizational entities hosting the external systems.
Restrict the use of organization-controlled portable storage devices by authorized individuals on external systems.

## What to Check

- [ ] Verify Use of External Systems (03.01.20) Use of External Systems is implemented for CUI systems
- [ ] Review SSP documentation for Use of External Systems (03.01.20)
- [ ] Validate CMMC Level 2 assessment objective for Use of External Systems (03.01.20)
- [ ] Confirm POA&M addresses any gaps for Use of External Systems (03.01.20)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Use of External Systems (03.01.20) implementation description and responsible parties.

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

Prohibit the use of external systems unless the systems are specifically authorized.
Establish the following security requirements to be satisfied on external systems prior to allowing use of or access to those systems by authorized individuals: [organization-defined].
Permit authorized individuals to use external systems to access the organizational system or to process, store, or transmit CUI only after:
Verifying that the security requirements on the external systems as specified in the organization’s system security plans have been satisfied and
Retaining approved system connection or processing agreements with the organizational entities hosting the external systems.
Restrict the use of organization-controlled portable storage devices by authorized individuals on external systems.

### Supplemental Guidance

External systems are systems that are used by but are not part of the organization. These systems include personally owned systems, system components, or devices; privately owned computing and communication devices in commercial or public facilities; systems owned or controlled by nonfederal organizations; and systems managed by contractors. Organizations have the option to prohibit the use of any type of external system or specified types of external systems (e.g., prohibit the use of external systems that are not organizationally owned). Terms and conditions are consistent with the trust relationships established with the entities that own, operate, or maintain external systems and include descriptions of shared responsibilities. Authorized individuals include organizational personnel, contractors, or other individuals with authorized access to the organizational system and over whom organizations have the authority to impose specific rules of behavior regarding system access. Restrictions that organizations impose on authorized individuals may vary depending on the trust relationships between organizations. Organizations need assurance that external systems satisfy the necessary security requirements so as not to compromise, damage, or harm the system. This requirement is related to [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.16.03) 03.16.03.

## Risk Assessment

| Finding                                                                    | Severity | Impact                          |
| -------------------------------------------------------------------------- | -------- | ------------------------------- |
| Use of External Systems (03.01.20) Use of External Systems not implemented | High     | CUI Protection - Access Control |
| Use of External Systems (03.01.20) partially implemented (POA&M)           | Medium   | CMMC certification risk         |

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

- [ ] SSP documents Use of External Systems (03.01.20) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
