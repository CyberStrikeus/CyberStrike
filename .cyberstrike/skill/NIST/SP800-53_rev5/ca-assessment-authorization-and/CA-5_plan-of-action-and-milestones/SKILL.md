---
name: "CA-5_plan-of-action-and-milestones"
description: "Develop a plan of action and milestones for the system to document the planned remediation actions of the organization to correct weaknesses or def..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ca-5
  - ca
tech_stack:
  - any
cwe_ids: []
chains_with:
  - CA-2
  - CA-7
  - PM-4
  - PM-9
  - RA-7
  - SI-2
  - SI-12
prerequisites: []
severity_boost:
  CA-2: "Chain with CA-2 for comprehensive security coverage"
  CA-7: "Chain with CA-7 for comprehensive security coverage"
  PM-4: "Chain with PM-4 for comprehensive security coverage"
---

# CA-5 Plan of Action and Milestones

## High-Level Description

**Family:** Assessment, Authorization, and Monitoring (CA)
**Framework:** NIST SP 800-53 Rev 5

Plans of action and milestones are useful for any type of organization to track planned remedial actions. Plans of action and milestones are required in authorization packages and subject to federal reporting requirements established by OMB.

## What to Check

- [ ] Verify CA-5 Plan of Action and Milestones is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CA-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop a plan of action and milestones for the system to document the planned remediation actions of the organization to correct weaknesses or deficiencies noted during the assessment of the controls and to reduce or eliminate known vulnerabilities in the system; and
Update existing plan of action and milestones [organization-defined] based on the findings from control assessments, independent audits or reviews, and continuous monitoring activities.

### Implementation Guidance

Plans of action and milestones are useful for any type of organization to track planned remedial actions. Plans of action and milestones are required in authorization packages and subject to federal reporting requirements established by OMB.

## Risk Assessment

| Finding                                            | Severity | Impact                                               |
| -------------------------------------------------- | -------- | ---------------------------------------------------- |
| CA-5 Plan of Action and Milestones not implemented | Medium   | Assessment, Authorization, and Monitoring            |
| CA-5 partially implemented                         | Low      | Incomplete Assessment, Authorization, and Monitoring |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CA-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ca-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-2, CA-7, PM-4, PM-9, RA-7) reviewed
