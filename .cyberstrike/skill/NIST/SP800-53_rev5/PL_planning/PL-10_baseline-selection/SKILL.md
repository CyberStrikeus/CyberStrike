---
name: "PL-10_baseline-selection"
description: "Select a control baseline for the system."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pl-10
  - pl
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - PL-2
  - PL-11
  - RA-2
  - RA-3
  - SA-8
prerequisites:
  []
severity_boost:
  PL-2: "Chain with PL-2 for comprehensive security coverage"
  PL-11: "Chain with PL-11 for comprehensive security coverage"
  RA-2: "Chain with RA-2 for comprehensive security coverage"
---

# PL-10 Baseline Selection

## High-Level Description

**Family:** Planning (PL)
**Framework:** NIST SP 800-53 Rev 5

Control baselines are predefined sets of controls specifically assembled to address the protection needs of a group, organization, or community of interest. Controls are chosen for baselines to either satisfy mandates imposed by laws, executive orders, directives, regulations, policies, standards, and guidelines or address threats common to all users of the baseline under the assumptions specific to the baseline. Baselines represent a starting point for the protection of individuals’ privacy, information, and information systems with subsequent tailoring actions to manage risk in accordance with mission, business, or other constraints (see [PL-11](#pl-11) ). Federal control baselines are provided in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) . The selection of a control baseline is determined by the needs of stakeholders. Stakeholder needs consider mission and business requirements as well as mandates imposed by applicable laws, executive orders, directives, policies, regulations, standards, and guidelines. For example, the control baselines in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) are based on the requirements from [FISMA](#0c67b2a9-bede-43d2-b86d-5f35b8be36e9) and [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) . The requirements, along with the NIST standards and guidelines implementing the legislation, direct organizations to select one of the control baselines after the reviewing the information types and the information that is processed, stored, and transmitted on the system; analyzing the potential adverse impact of the loss or compromise of the information or system on the organization’s operations and assets, individuals, other organizations, or the Nation; and considering the results from system and organizational risk assessments. [CNSSI 1253](#4e4fbc93-333d-45e6-a875-de36b878b6b9) provides guidance on control baselines for national security systems.

## What to Check

- [ ] Verify PL-10 Baseline Selection is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PL-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PL-10 implementation details. Verify the organization has documented how this control is satisfied.

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

Select a control baseline for the system.

### Implementation Guidance

Control baselines are predefined sets of controls specifically assembled to address the protection needs of a group, organization, or community of interest. Controls are chosen for baselines to either satisfy mandates imposed by laws, executive orders, directives, regulations, policies, standards, and guidelines or address threats common to all users of the baseline under the assumptions specific to the baseline. Baselines represent a starting point for the protection of individuals’ privacy, information, and information systems with subsequent tailoring actions to manage risk in accordance with mission, business, or other constraints (see [PL-11](#pl-11) ). Federal control baselines are provided in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) . The selection of a control baseline is determined by the needs of stakeholders. Stakeholder needs consider mission and business requirements as well as mandates imposed by applicable laws, executive orders, directives, policies, regulations, standards, and guidelines. For example, the control baselines in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) are based on the requirements from [FISMA](#0c67b2a9-bede-43d2-b86d-5f35b8be36e9) and [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) . The requirements, along with the NIST standards and guidelines implementing the legislation, direct organizations to select one of the control baselines after the reviewing the information types and the information that is processed, stored, and transmitted on the system; analyzing the potential adverse impact of the loss or compromise of the information or system on the organization’s operations and assets, individuals, other organizations, or the Nation; and considering the results from system and organizational risk assessments. [CNSSI 1253](#4e4fbc93-333d-45e6-a875-de36b878b6b9) provides guidance on control baselines for national security systems.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PL-10 Baseline Selection not implemented | Medium | Planning |
| PL-10 partially implemented | Low | Incomplete Planning |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PL-10](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pl-10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PL-2, PL-11, RA-2, RA-3, SA-8) reviewed
