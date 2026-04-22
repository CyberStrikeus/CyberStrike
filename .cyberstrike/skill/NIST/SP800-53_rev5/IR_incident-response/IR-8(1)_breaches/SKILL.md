---
name: "IR-8(1)_breaches"
description: "Include the following in the Incident Response Plan for breaches involving personally identifiable information: A process to determine if notice to in"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ir-8-1
  - ir
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - PT-1
  - PT-2
  - PT-3
  - PT-4
  - PT-5
  - PT-7
prerequisites:
  - IR-8
severity_boost:
  PT-1: "Chain with PT-1 for comprehensive security coverage"
  PT-2: "Chain with PT-2 for comprehensive security coverage"
  PT-3: "Chain with PT-3 for comprehensive security coverage"
---

# IR-8(1) Breaches

> **Enhancement of:** IR-8

## High-Level Description

**Family:** Incident Response (IR)
**Framework:** NIST SP 800-53 Rev 5

Organizations may be required by law, regulation, or policy to follow specific procedures relating to breaches, including notice to individuals, affected organizations, and oversight bodies; standards of harm; and mitigation or other specific requirements.

## What to Check

- [ ] Verify IR-8(1) Breaches is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IR-8(1)
- [ ] Verify enhancement builds upon base control IR-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IR-8(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Include the following in the Incident Response Plan for breaches involving personally identifiable information:
A process to determine if notice to individuals or other organizations, including oversight organizations, is needed;
An assessment process to determine the extent of the harm, embarrassment, inconvenience, or unfairness to affected individuals and any mechanisms to mitigate such harms; and
Identification of applicable privacy requirements.

### Implementation Guidance

Organizations may be required by law, regulation, or policy to follow specific procedures relating to breaches, including notice to individuals, affected organizations, and oversight bodies; standards of harm; and mitigation or other specific requirements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IR-8(1) Breaches not implemented | Medium | Incident Response |
| IR-8(1) partially implemented | Low | Incomplete Incident Response |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - IR-8(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ir-8.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PT-1, PT-2, PT-3, PT-4, PT-5) reviewed
