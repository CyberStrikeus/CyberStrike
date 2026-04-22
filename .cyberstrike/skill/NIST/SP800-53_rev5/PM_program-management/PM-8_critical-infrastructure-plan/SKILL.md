---
name: "PM-8_critical-infrastructure-plan"
description: "Address information security and privacy issues in the development, documentation, and updating of a critical infrastructure and key resources protect"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-8
  - pm
tech_stack:
  - any
cwe_ids: []
chains_with:
  - CP-2
  - CP-4
  - PE-18
  - PL-2
  - PM-9
  - PM-11
  - PM-18
  - RA-3
  - SI-12
prerequisites: []
severity_boost:
  CP-2: "Chain with CP-2 for comprehensive security coverage"
  CP-4: "Chain with CP-4 for comprehensive security coverage"
  PE-18: "Chain with PE-18 for comprehensive security coverage"
---

# PM-8 Critical Infrastructure Plan

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

Protection strategies are based on the prioritization of critical assets and resources. The requirement and guidance for defining critical infrastructure and key resources and for preparing an associated critical infrastructure protection plan are found in applicable laws, executive orders, directives, policies, regulations, standards, and guidelines.

## What to Check

- [ ] Verify PM-8 Critical Infrastructure Plan is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-8 implementation details. Verify the organization has documented how this control is satisfied.

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

Address information security and privacy issues in the development, documentation, and updating of a critical infrastructure and key resources protection plan.

### Implementation Guidance

Protection strategies are based on the prioritization of critical assets and resources. The requirement and guidance for defining critical infrastructure and key resources and for preparing an associated critical infrastructure protection plan are found in applicable laws, executive orders, directives, policies, regulations, standards, and guidelines.

## Risk Assessment

| Finding                                           | Severity | Impact                        |
| ------------------------------------------------- | -------- | ----------------------------- |
| PM-8 Critical Infrastructure Plan not implemented | Medium   | Program Management            |
| PM-8 partially implemented                        | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-8](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-2, CP-4, PE-18, PL-2, PM-9) reviewed
