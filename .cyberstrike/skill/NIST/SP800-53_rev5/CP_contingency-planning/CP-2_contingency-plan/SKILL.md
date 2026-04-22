---
name: "CP-2_contingency-plan"
description: "Develop a contingency plan for the system that: Identifies essential mission and business functions and associated contingency requirements; Provides "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-2
  - cp
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids: []
chains_with:
  - CP-3
  - CP-4
  - CP-6
  - CP-7
  - CP-8
  - CP-9
  - CP-10
  - CP-11
  - CP-13
  - IR-4
prerequisites: []
severity_boost:
  CP-3: "Chain with CP-3 for comprehensive security coverage"
  CP-4: "Chain with CP-4 for comprehensive security coverage"
  CP-6: "Chain with CP-6 for comprehensive security coverage"
---

# CP-2 Contingency Plan

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Contingency planning for systems is part of an overall program for achieving continuity of operations for organizational mission and business functions. Contingency planning addresses system restoration and implementation of alternative mission or business processes when systems are compromised or breached. Contingency planning is considered throughout the system development life cycle and is a fundamental part of the system design. Systems can be designed for redundancy, to provide backup capabilities, and for resilience. Contingency plans reflect the degree of restoration required for organizational systems since not all systems need to fully recover to achieve the level of continuity of operations desired. System recovery objectives reflect applicable laws, executive orders, directives, regulations, policies, standards, guidelines, organizational risk tolerance, and system impact level.

Actions addressed in contingency plans include orderly system degradation, system shutdown, fallback to a manual mode, alternate information flows, and operating in modes reserved for when systems are under attack. By coordinating contingency planning with incident handling activities, organizations ensure that the necessary planning activities are in place and activated in the event of an incident. Organizations consider whether continuity of operations during an incident conflicts with the capability to automatically disable the system, as specified in [IR-4(5)](#ir-4.5) . Incident response planning is part of contingency planning for organizations and is addressed in the [IR](#ir) (Incident Response) family.

## What to Check

- [ ] Verify CP-2 Contingency Plan is documented in SSP
- [ ] Validate all 14 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-2 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop a contingency plan for the system that:
Identifies essential mission and business functions and associated contingency requirements;
Provides recovery objectives, restoration priorities, and metrics;
Addresses contingency roles, responsibilities, assigned individuals with contact information;
Addresses maintaining essential mission and business functions despite a system disruption, compromise, or failure;
Addresses eventual, full system restoration without deterioration of the controls originally planned and implemented;
Addresses the sharing of contingency information; and
Is reviewed and approved by [organization-defined];
Distribute copies of the contingency plan to [organization-defined];
Coordinate contingency planning activities with incident handling activities;
Review the contingency plan for the system [organization-defined];
Update the contingency plan to address changes to the organization, system, or environment of operation and problems encountered during contingency plan implementation, execution, or testing;
Communicate contingency plan changes to [organization-defined];
Incorporate lessons learned from contingency plan testing, training, or actual contingency activities into contingency testing and training; and
Protect the contingency plan from unauthorized disclosure and modification.

### Implementation Guidance

Contingency planning for systems is part of an overall program for achieving continuity of operations for organizational mission and business functions. Contingency planning addresses system restoration and implementation of alternative mission or business processes when systems are compromised or breached. Contingency planning is considered throughout the system development life cycle and is a fundamental part of the system design. Systems can be designed for redundancy, to provide backup capabilities, and for resilience. Contingency plans reflect the degree of restoration required for organizational systems since not all systems need to fully recover to achieve the level of continuity of operations desired. System recovery objectives reflect applicable laws, executive orders, directives, regulations, policies, standards, guidelines, organizational risk tolerance, and system impact level.

Actions addressed in contingency plans include orderly system degradation, system shutdown, fallback to a manual mode, alternate information flows, and operating in modes reserved for when systems are under attack. By coordinating contingency planning with incident handling activities, organizations ensure that the necessary planning activities are in place and activated in the event of an incident. Organizations consider whether continuity of operations during an incident conflicts with the capability to automatically disable the system, as specified in [IR-4(5)](#ir-4.5) . Incident response planning is part of contingency planning for organizations and is addressed in the [IR](#ir) (Incident Response) family.

## Risk Assessment

| Finding                               | Severity | Impact                          |
| ------------------------------------- | -------- | ------------------------------- |
| CP-2 Contingency Plan not implemented | Medium   | Contingency Planning            |
| CP-2 partially implemented            | Low      | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-2](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-3, CP-4, CP-6, CP-7, CP-8) reviewed
