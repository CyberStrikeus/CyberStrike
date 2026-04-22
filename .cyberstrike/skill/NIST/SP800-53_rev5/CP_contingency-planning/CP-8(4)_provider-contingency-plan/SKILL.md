---
name: "CP-8(4)_provider-contingency-plan"
description: "Require primary and alternate telecommunications service providers to have contingency plans;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-8-4
  - cp
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids: []
chains_with:
  - CP-3
  - CP-4
prerequisites:
  - CP-8
severity_boost:
  CP-3: "Chain with CP-3 for comprehensive security coverage"
  CP-4: "Chain with CP-4 for comprehensive security coverage"
---

# CP-8(4) Provider Contingency Plan

> **Enhancement of:** CP-8

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Reviews of provider contingency plans consider the proprietary nature of such plans. In some situations, a summary of provider contingency plans may be sufficient evidence for organizations to satisfy the review requirement. Telecommunications service providers may also participate in ongoing disaster recovery exercises in coordination with the Department of Homeland Security and state and local governments. Organizations may use these types of activities to satisfy evidentiary requirements related to service provider contingency plan reviews, testing, and training.

## What to Check

- [ ] Verify CP-8(4) Provider Contingency Plan is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-8(4)
- [ ] Verify enhancement builds upon base control CP-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-8(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Require primary and alternate telecommunications service providers to have contingency plans;
Review provider contingency plans to ensure that the plans meet organizational contingency requirements; and
Obtain evidence of contingency testing and training by providers [organization-defined].

### Implementation Guidance

Reviews of provider contingency plans consider the proprietary nature of such plans. In some situations, a summary of provider contingency plans may be sufficient evidence for organizations to satisfy the review requirement. Telecommunications service providers may also participate in ongoing disaster recovery exercises in coordination with the Department of Homeland Security and state and local governments. Organizations may use these types of activities to satisfy evidentiary requirements related to service provider contingency plan reviews, testing, and training.

## Risk Assessment

| Finding                                           | Severity | Impact                          |
| ------------------------------------------------- | -------- | ------------------------------- |
| CP-8(4) Provider Contingency Plan not implemented | Medium   | Contingency Planning            |
| CP-8(4) partially implemented                     | Low      | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-8(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-8.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-3, CP-4) reviewed
