---
name: "AT-3(2)_physical-security-controls"
description: "Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of physical security controls."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-3-2
  - at
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - PE-2
  - PE-3
  - PE-4
prerequisites:
  - AT-3
severity_boost:
  PE-2: "Chain with PE-2 for comprehensive security coverage"
  PE-3: "Chain with PE-3 for comprehensive security coverage"
  PE-4: "Chain with PE-4 for comprehensive security coverage"
---

# AT-3(2) Physical Security Controls

> **Enhancement of:** AT-3

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Physical security controls include physical access control devices, physical intrusion and detection alarms, operating procedures for facility security guards, and monitoring or surveillance equipment.

## What to Check

- [ ] Verify AT-3(2) Physical Security Controls is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-3(2)
- [ ] Verify enhancement builds upon base control AT-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-3(2) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool          | Purpose                           | Usage |
| ------------- | --------------------------------- | ----- |
| Manual Review | Documentation and interview-based | N/A   |

## Remediation Guide

### Control Statement

Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of physical security controls.

### Implementation Guidance

Physical security controls include physical access control devices, physical intrusion and detection alarms, operating procedures for facility security guards, and monitoring or surveillance equipment.

## Risk Assessment

| Finding                                            | Severity | Impact                            |
| -------------------------------------------------- | -------- | --------------------------------- |
| AT-3(2) Physical Security Controls not implemented | Medium   | Awareness and Training            |
| AT-3(2) partially implemented                      | Low      | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-3(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-3.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PE-2, PE-3, PE-4) reviewed
