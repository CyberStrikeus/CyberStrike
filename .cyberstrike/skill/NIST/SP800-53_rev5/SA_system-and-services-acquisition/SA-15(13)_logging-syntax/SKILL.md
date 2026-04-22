---
name: "SA-15(13)_logging-syntax"
description: "Require the developer of the system or system component to minimize the use of personally identifiable information in development and test environment"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-15-13
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - AU-2
  - AU-3
  - IR-4
  - IR-8
  - SA-5
prerequisites:
  - SA-15
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-3: "Chain with AU-3 for comprehensive security coverage"
  IR-4: "Chain with IR-4 for comprehensive security coverage"
---

# SA-15(13) Logging Syntax

> **Enhancement of:** SA-15

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

In support of better incident response and the ability to more quickly reconstruct security-related actions, identifying specific requirements for secure logging facilitates the ability to connect application-produced audit event logs with operational data. Event types are consistent with the event types defined in [AU-02](#au-2).

## What to Check

- [ ] Verify SA-15(13) Logging Syntax is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-15(13)
- [ ] Verify enhancement builds upon base control SA-15

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-15(13) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system or system component to minimize the use of personally identifiable information in development and test environments.

### Implementation Guidance

In support of better incident response and the ability to more quickly reconstruct security-related actions, identifying specific requirements for secure logging facilitates the ability to connect application-produced audit event logs with operational data. Event types are consistent with the event types defined in [AU-02](#au-2).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SA-15(13) Logging Syntax not implemented | Medium | System and Services Acquisition |
| SA-15(13) partially implemented | Low | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - SA-15(13)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-15.13)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-3, IR-4, IR-8, SA-5) reviewed
