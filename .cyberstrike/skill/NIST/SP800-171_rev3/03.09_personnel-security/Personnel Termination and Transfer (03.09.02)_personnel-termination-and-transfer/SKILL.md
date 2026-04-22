---
name: "Personnel Termination and Transfer (03.09.02)_personnel-termination-and-transfer"
description: "When individual employment is terminated: Disable system access within [organization-defined], Terminate or revoke authenticators and credentials asso"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - personnel termination and transfer (03-09-02)
  - family-03.09
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Personnel Termination and Transfer (03.09.02) Personnel Termination and Transfer

## High-Level Description

**Family:** Personnel Security
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

When individual employment is terminated:
Disable system access within [organization-defined],
Terminate or revoke authenticators and credentials associated with the individual, and
Retrieve security-related system property.
When individuals are reassigned or transferred to other positions in the organization:
Review and confirm the ongoing operational need for current logical and physical access authorizations to the system and facility, and
Modify access authorization to correspond with any changes in operational need.

## What to Check

- [ ] Verify Personnel Termination and Transfer (03.09.02) Personnel Termination and Transfer is implemented for CUI systems
- [ ] Review SSP documentation for Personnel Termination and Transfer (03.09.02)
- [ ] Validate CMMC Level 2 assessment objective for Personnel Termination and Transfer (03.09.02)
- [ ] Confirm POA&M addresses any gaps for Personnel Termination and Transfer (03.09.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Personnel Termination and Transfer (03.09.02) implementation description and responsible parties.

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

When individual employment is terminated:
Disable system access within [organization-defined],
Terminate or revoke authenticators and credentials associated with the individual, and
Retrieve security-related system property.
When individuals are reassigned or transferred to other positions in the organization:
Review and confirm the ongoing operational need for current logical and physical access authorizations to the system and facility, and
Modify access authorization to correspond with any changes in operational need.

### Supplemental Guidance

Security-related system property includes hardware authentication tokens, system administration technical manuals, keys, identification cards, and building passes. Exit interviews ensure that terminated individuals understand the security constraints imposed by being former employees and that accountability is achieved for the organizational property. Security topics at exit interviews include reminding individuals of potential limitations on future employment and non-disclosure agreements. Exit interviews may not always be possible for some individuals, including in cases related to the unavailability of supervisors, illnesses, or job abandonment. The timely execution of termination actions is essential for individuals who have been terminated for cause. Organizations may consider disabling the accounts of individuals who are being terminated prior to the individuals being notified. This requirement applies to the reassignment or transfer of individuals when the personnel action is permanent or of such extended duration as to require protection. Protections that may be required for transfers or reassignments to other positions within organizations include returning old and issuing new identification cards, keys, and building passes; changing system access authorizations (i.e., privileges); closing system accounts and establishing new accounts; and providing access to official records to which individuals had access at previous work locations in previous system accounts.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Personnel Termination and Transfer (03.09.02) Personnel Termination and Transfer not implemented | Medium | CUI Protection - Personnel Security |
| Personnel Termination and Transfer (03.09.02) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Personnel Termination and Transfer (03.09.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
