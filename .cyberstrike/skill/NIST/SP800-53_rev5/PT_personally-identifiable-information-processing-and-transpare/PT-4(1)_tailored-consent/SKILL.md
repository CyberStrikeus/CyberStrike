---
name: "PT-4(1)_tailored-consent"
description: "Provide [organization-defined] to allow individuals to tailor processing permissions to selected elements of personally identifiable information."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-4-1
  - pt
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - PT-2
prerequisites:
  - PT-4
severity_boost:
  PT-2: "Chain with PT-2 for comprehensive security coverage"
---

# PT-4(1) Tailored Consent

> **Enhancement of:** PT-4

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

While some processing may be necessary for the basic functionality of the product or service, other processing may not. In these circumstances, organizations allow individuals to select how specific personally identifiable information elements may be processed. More tailored consent may help reduce privacy risk, increase individual satisfaction, and avoid adverse behaviors, such as abandonment of the product or service.

## What to Check

- [ ] Verify PT-4(1) Tailored Consent is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-4(1)
- [ ] Verify enhancement builds upon base control PT-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-4(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide [organization-defined] to allow individuals to tailor processing permissions to selected elements of personally identifiable information.

### Implementation Guidance

While some processing may be necessary for the basic functionality of the product or service, other processing may not. In these circumstances, organizations allow individuals to select how specific personally identifiable information elements may be processed. More tailored consent may help reduce privacy risk, increase individual satisfaction, and avoid adverse behaviors, such as abandonment of the product or service.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PT-4(1) Tailored Consent not implemented | Medium | Personally Identifiable Information Processing and Transparency |
| PT-4(1) partially implemented | Low | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-359 | Exposure of Private Personal Information |


## References

- [NIST SP 800-53 Rev 5 - PT-4(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-4.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PT-2) reviewed
