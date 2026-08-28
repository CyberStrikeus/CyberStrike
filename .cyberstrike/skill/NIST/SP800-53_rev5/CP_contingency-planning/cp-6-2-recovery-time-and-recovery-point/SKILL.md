---
name: "CP-6(2)_recovery-time-and-recovery-point-objectives"
description: "Configure the alternate storage site to facilitate recovery operations in accordance with recovery time and recovery point objectives."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-6-2
  - cp
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids: []
chains_with: []
prerequisites:
  - CP-6
severity_boost: {}
---

# CP-6(2) Recovery Time and Recovery Point Objectives

> **Enhancement of:** CP-6

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Organizations establish recovery time and recovery point objectives as part of contingency planning. Configuration of the alternate storage site includes physical facilities and the systems supporting recovery operations that ensure accessibility and correct execution.

## What to Check

- [ ] Verify CP-6(2) Recovery Time and Recovery Point Objectives is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-6(2)
- [ ] Verify enhancement builds upon base control CP-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-6(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Configure the alternate storage site to facilitate recovery operations in accordance with recovery time and recovery point objectives.

### Implementation Guidance

Organizations establish recovery time and recovery point objectives as part of contingency planning. Configuration of the alternate storage site includes physical facilities and the systems supporting recovery operations that ensure accessibility and correct execution.

## Risk Assessment

| Finding                                                             | Severity | Impact                          |
| ------------------------------------------------------------------- | -------- | ------------------------------- |
| CP-6(2) Recovery Time and Recovery Point Objectives not implemented | Medium   | Contingency Planning            |
| CP-6(2) partially implemented                                       | Low      | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-6(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-6.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
