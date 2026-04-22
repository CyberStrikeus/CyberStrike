---
name: "PS-4_personnel-termination"
description: "Upon termination of individual employment: Disable system access within [organization-defined]; Terminate or revoke any authenticators and credentials"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-4
  - ps
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AC-2
  - IA-4
  - PE-2
  - PM-12
  - PS-6
  - PS-7
prerequisites:
  []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  IA-4: "Chain with IA-4 for comprehensive security coverage"
  PE-2: "Chain with PE-2 for comprehensive security coverage"
---

# PS-4 Personnel Termination

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

System property includes hardware authentication tokens, system administration technical manuals, keys, identification cards, and building passes. Exit interviews ensure that terminated individuals understand the security constraints imposed by being former employees and that proper accountability is achieved for system-related property. Security topics at exit interviews include reminding individuals of nondisclosure agreements and potential limitations on future employment. Exit interviews may not always be possible for some individuals, including in cases related to the unavailability of supervisors, illnesses, or job abandonment. Exit interviews are important for individuals with security clearances. The timely execution of termination actions is essential for individuals who have been terminated for cause. In certain situations, organizations consider disabling the system accounts of individuals who are being terminated prior to the individuals being notified.

## What to Check

- [ ] Verify PS-4 Personnel Termination is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-4 implementation details. Verify the organization has documented how this control is satisfied.

### Step 2: Validate Implementation

```
# For cloud environments, use cloud-audit-mcp tools
# For on-premises, review system configurations directly

# Example: Check if account management policies exist
grep -r "account.management\|access.control" /etc/security/ 2>/dev/null
```

### Step 3: Test Operating Effectiveness

Verify the control is actively functioning, not just documented. Check logs, configurations, and operational evidence.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Upon termination of individual employment:
Disable system access within [organization-defined];
Terminate or revoke any authenticators and credentials associated with the individual;
Conduct exit interviews that include a discussion of [organization-defined];
Retrieve all security-related organizational system-related property; and
Retain access to organizational information and systems formerly controlled by terminated individual.

### Implementation Guidance

System property includes hardware authentication tokens, system administration technical manuals, keys, identification cards, and building passes. Exit interviews ensure that terminated individuals understand the security constraints imposed by being former employees and that proper accountability is achieved for system-related property. Security topics at exit interviews include reminding individuals of nondisclosure agreements and potential limitations on future employment. Exit interviews may not always be possible for some individuals, including in cases related to the unavailability of supervisors, illnesses, or job abandonment. Exit interviews are important for individuals with security clearances. The timely execution of termination actions is essential for individuals who have been terminated for cause. In certain situations, organizations consider disabling the system accounts of individuals who are being terminated prior to the individuals being notified.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PS-4 Personnel Termination not implemented | Medium | Personnel Security |
| PS-4 partially implemented | Low | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-4](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, IA-4, PE-2, PM-12, PS-6) reviewed
