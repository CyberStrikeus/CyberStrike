---
name: "RA-3_risk-assessment"
description: "Conduct a risk assessment, including: Identifying threats to and vulnerabilities in the system; Determining the likelihood and magnitude of harm from "
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ra-3
  - ra
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CA-3
  - CA-6
  - CM-4
  - CM-13
  - CP-6
  - CP-7
  - IA-8
  - MA-5
  - PE-3
  - PE-8
prerequisites:
  []
severity_boost:
  CA-3: "Chain with CA-3 for comprehensive security coverage"
  CA-6: "Chain with CA-6 for comprehensive security coverage"
  CM-4: "Chain with CM-4 for comprehensive security coverage"
---

# RA-3 Risk Assessment

## High-Level Description

**Family:** Risk Assessment (RA)
**Framework:** NIST SP 800-53 Rev 5

Risk assessments consider threats, vulnerabilities, likelihood, and impact to organizational operations and assets, individuals, other organizations, and the Nation. Risk assessments also consider risk from external parties, including contractors who operate systems on behalf of the organization, individuals who access organizational systems, service providers, and outsourcing entities.

Organizations can conduct risk assessments at all three levels in the risk management hierarchy (i.e., organization level, mission/business process level, or information system level) and at any stage in the system development life cycle. Risk assessments can also be conducted at various steps in the Risk Management Framework, including preparation, categorization, control selection, control implementation, control assessment, authorization, and control monitoring. Risk assessment is an ongoing activity carried out throughout the system development life cycle.

Risk assessments can also address information related to the system, including system design, the intended use of the system, testing results, and supply chain-related information or artifacts. Risk assessments can play an important role in control selection processes, particularly during the application of tailoring guidance and in the earliest phases of capability determination.

## What to Check

- [ ] Verify RA-3 Risk Assessment is documented in SSP
- [ ] Validate all 8 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for RA-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for RA-3 implementation details. Verify the organization has documented how this control is satisfied.

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

Conduct a risk assessment, including:
Identifying threats to and vulnerabilities in the system;
Determining the likelihood and magnitude of harm from unauthorized access, use, disclosure, disruption, modification, or destruction of the system, the information it processes, stores, or transmits, and any related information; and
Determining the likelihood and impact of adverse effects on individuals arising from the processing of personally identifiable information;
Integrate risk assessment results and risk management decisions from the organization and mission or business process perspectives with system-level risk assessments;
Document risk assessment results in [organization-defined];
Review risk assessment results [organization-defined];
Disseminate risk assessment results to [organization-defined] ; and
Update the risk assessment [organization-defined] or when there are significant changes to the system, its environment of operation, or other conditions that may impact the security or privacy state of the system.

### Implementation Guidance

Risk assessments consider threats, vulnerabilities, likelihood, and impact to organizational operations and assets, individuals, other organizations, and the Nation. Risk assessments also consider risk from external parties, including contractors who operate systems on behalf of the organization, individuals who access organizational systems, service providers, and outsourcing entities.

Organizations can conduct risk assessments at all three levels in the risk management hierarchy (i.e., organization level, mission/business process level, or information system level) and at any stage in the system development life cycle. Risk assessments can also be conducted at various steps in the Risk Management Framework, including preparation, categorization, control selection, control implementation, control assessment, authorization, and control monitoring. Risk assessment is an ongoing activity carried out throughout the system development life cycle.

Risk assessments can also address information related to the system, including system design, the intended use of the system, testing results, and supply chain-related information or artifacts. Risk assessments can play an important role in control selection processes, particularly during the application of tailoring guidance and in the earliest phases of capability determination.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RA-3 Risk Assessment not implemented | Medium | Risk Assessment |
| RA-3 partially implemented | Low | Incomplete Risk Assessment |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - RA-3](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ra-3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-3, CA-6, CM-4, CM-13, CP-6) reviewed
