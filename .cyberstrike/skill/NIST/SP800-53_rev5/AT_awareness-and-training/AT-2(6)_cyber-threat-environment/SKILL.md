---
name: "AT-2(6)_cyber-threat-environment"
description: "Provide literacy training on the cyber threat environment;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-2-6
  - at
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - RA-3
prerequisites:
  - AT-2
severity_boost:
  RA-3: "Chain with RA-3 for comprehensive security coverage"
---

# AT-2(6) Cyber Threat Environment

> **Enhancement of:** AT-2

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Since threats continue to change over time, threat literacy training by the organization is dynamic. Moreover, threat literacy training is not performed in isolation from the system operations that support organizational mission and business functions.

## What to Check

- [ ] Verify AT-2(6) Cyber Threat Environment is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-2(6)
- [ ] Verify enhancement builds upon base control AT-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-2(6) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide literacy training on the cyber threat environment; and
Reflect current cyber threat information in system operations.

### Implementation Guidance

Since threats continue to change over time, threat literacy training by the organization is dynamic. Moreover, threat literacy training is not performed in isolation from the system operations that support organizational mission and business functions.

## Risk Assessment

| Finding                                          | Severity | Impact                            |
| ------------------------------------------------ | -------- | --------------------------------- |
| AT-2(6) Cyber Threat Environment not implemented | Medium   | Awareness and Training            |
| AT-2(6) partially implemented                    | Low      | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-2(6)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-2.6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (RA-3) reviewed
