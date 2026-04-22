---
name: "PM-28_risk-framing"
description: "Identify and document: Assumptions affecting risk assessments, risk responses, and risk monitoring; Constraints affecting risk assessments, risk respo"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-28
  - pm
tech_stack:
  - any
cwe_ids: []
chains_with:
  - CA-7
  - PM-9
  - RA-3
  - RA-7
prerequisites: []
severity_boost:
  CA-7: "Chain with CA-7 for comprehensive security coverage"
  PM-9: "Chain with PM-9 for comprehensive security coverage"
  RA-3: "Chain with RA-3 for comprehensive security coverage"
---

# PM-28 Risk Framing

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

Risk framing is most effective when conducted at the organization level and in consultation with stakeholders throughout the organization including mission, business, and system owners. The assumptions, constraints, risk tolerance, priorities, and trade-offs identified as part of the risk framing process inform the risk management strategy, which in turn informs the conduct of risk assessment, risk response, and risk monitoring activities. Risk framing results are shared with organizational personnel, including mission and business owners, information owners or stewards, system owners, authorizing officials, senior agency information security officer, senior agency official for privacy, and senior accountable official for risk management.

## What to Check

- [ ] Verify PM-28 Risk Framing is documented in SSP
- [ ] Validate all 6 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-28

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-28 implementation details. Verify the organization has documented how this control is satisfied.

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

Identify and document:
Assumptions affecting risk assessments, risk responses, and risk monitoring;
Constraints affecting risk assessments, risk responses, and risk monitoring;
Priorities and trade-offs considered by the organization for managing risk; and
Organizational risk tolerance;
Distribute the results of risk framing activities to [organization-defined] ; and
Review and update risk framing considerations [organization-defined].

### Implementation Guidance

Risk framing is most effective when conducted at the organization level and in consultation with stakeholders throughout the organization including mission, business, and system owners. The assumptions, constraints, risk tolerance, priorities, and trade-offs identified as part of the risk framing process inform the risk management strategy, which in turn informs the conduct of risk assessment, risk response, and risk monitoring activities. Risk framing results are shared with organizational personnel, including mission and business owners, information owners or stewards, system owners, authorizing officials, senior agency information security officer, senior agency official for privacy, and senior accountable official for risk management.

## Risk Assessment

| Finding                            | Severity | Impact                        |
| ---------------------------------- | -------- | ----------------------------- |
| PM-28 Risk Framing not implemented | Medium   | Program Management            |
| PM-28 partially implemented        | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-28](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-28)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-7, PM-9, RA-3, RA-7) reviewed
