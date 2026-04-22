---
name: "SR-11(3)_anti-counterfeit-scanning"
description: "Scan for counterfeit system components [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-11-3
  - sr
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - RA-5
prerequisites:
  - SR-11
severity_boost:
  RA-5: "Chain with RA-5 for comprehensive security coverage"
---

# SR-11(3) Anti-counterfeit Scanning

> **Enhancement of:** SR-11

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

The type of component determines the type of scanning to be conducted (e.g., web application scanning if the component is a web application).

## What to Check

- [ ] Verify SR-11(3) Anti-counterfeit Scanning is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-11(3)
- [ ] Verify enhancement builds upon base control SR-11

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-11(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Scan for counterfeit system components [organization-defined].

### Implementation Guidance

The type of component determines the type of scanning to be conducted (e.g., web application scanning if the component is a web application).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SR-11(3) Anti-counterfeit Scanning not implemented | Medium | Supply Chain Risk Management |
| SR-11(3) partially implemented | Low | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-11(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-11.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (RA-5) reviewed
