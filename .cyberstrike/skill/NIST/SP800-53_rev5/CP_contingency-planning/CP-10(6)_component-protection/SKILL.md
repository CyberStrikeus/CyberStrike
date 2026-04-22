---
name: "CP-10(6)_component-protection"
description: "Protect system components used for recovery and reconstitution."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-10-6
  - cp
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids: []
chains_with:
  - AC-3
  - AC-6
  - MP-2
  - MP-4
  - PE-3
  - PE-6
prerequisites:
  - CP-10
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-6: "Chain with AC-6 for comprehensive security coverage"
  MP-2: "Chain with MP-2 for comprehensive security coverage"
---

# CP-10(6) Component Protection

> **Enhancement of:** CP-10

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Protection of system recovery and reconstitution components (i.e., hardware, firmware, and software) includes physical and technical controls. Backup and restoration components used for recovery and reconstitution include router tables, compilers, and other system software.

## What to Check

- [ ] Verify CP-10(6) Component Protection is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-10(6)
- [ ] Verify enhancement builds upon base control CP-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-10(6) implementation details. Verify the organization has documented how this control is satisfied.

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

Protect system components used for recovery and reconstitution.

### Implementation Guidance

Protection of system recovery and reconstitution components (i.e., hardware, firmware, and software) includes physical and technical controls. Backup and restoration components used for recovery and reconstitution include router tables, compilers, and other system software.

## Risk Assessment

| Finding                                       | Severity | Impact                          |
| --------------------------------------------- | -------- | ------------------------------- |
| CP-10(6) Component Protection not implemented | Medium   | Contingency Planning            |
| CP-10(6) partially implemented                | Low      | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-10(6)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-10.6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, AC-6, MP-2, MP-4, PE-3) reviewed
