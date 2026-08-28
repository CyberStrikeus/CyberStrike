---
name: "PE-11(1)_alternate-power-supply-minimal-operational-capability"
description: "Provide an alternate power supply for the system that is activated [organization-defined] and that can maintain minimally required operational capabil"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-11-1
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - PE-11
severity_boost: {}
---

# PE-11(1) Alternate Power Supply — Minimal Operational Capability

> **Enhancement of:** PE-11

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Provision of an alternate power supply with minimal operating capability can be satisfied by accessing a secondary commercial power supply or other external power supply.

## What to Check

- [ ] Verify PE-11(1) Alternate Power Supply — Minimal Operational Capability is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-11(1)
- [ ] Verify enhancement builds upon base control PE-11

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-11(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide an alternate power supply for the system that is activated [organization-defined] and that can maintain minimally required operational capability in the event of an extended loss of the primary power source.

### Implementation Guidance

Provision of an alternate power supply with minimal operating capability can be satisfied by accessing a secondary commercial power supply or other external power supply.

## Risk Assessment

| Finding                                                                          | Severity | Impact                                           |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| PE-11(1) Alternate Power Supply — Minimal Operational Capability not implemented | Medium   | Physical and Environmental Protection            |
| PE-11(1) partially implemented                                                   | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-11(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-11.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
