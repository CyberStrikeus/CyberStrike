---
name: "PE-19(1)_national-emissions-policies-and-procedures"
description: "Protect system components, associated data communications, and networks in accordance with national Emissions Security policies and procedures based o"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-19-1
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  - PE-19
severity_boost: {}
---

# PE-19(1) National Emissions Policies and Procedures

> **Enhancement of:** PE-19

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Emissions Security (EMSEC) policies include the former TEMPEST policies.

## What to Check

- [ ] Verify PE-19(1) National Emissions Policies and Procedures is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-19(1)
- [ ] Verify enhancement builds upon base control PE-19

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-19(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Protect system components, associated data communications, and networks in accordance with national Emissions Security policies and procedures based on the security category or classification of the information.

### Implementation Guidance

Emissions Security (EMSEC) policies include the former TEMPEST policies.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-19(1) National Emissions Policies and Procedures not implemented | Medium | Physical and Environmental Protection |
| PE-19(1) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-19(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-19.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
