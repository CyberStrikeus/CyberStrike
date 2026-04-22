---
name: "SA-4_acquisition-process"
description: "Include the following requirements, descriptions, and criteria, explicitly or by reference, using [organization-defined] in the acquisition contract f"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-4
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CM-6
  - CM-8
  - PS-7
  - SA-3
  - SA-5
  - SA-8
  - SA-11
  - SA-15
  - SA-16
  - SA-17
prerequisites: []
severity_boost:
  CM-6: "Chain with CM-6 for comprehensive security coverage"
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  PS-7: "Chain with PS-7 for comprehensive security coverage"
---

# SA-4 Acquisition Process

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Security and privacy functional requirements are typically derived from the high-level security and privacy requirements described in [SA-2](#sa-2) . The derived requirements include security and privacy capabilities, functions, and mechanisms. Strength requirements associated with such capabilities, functions, and mechanisms include degree of correctness, completeness, resistance to tampering or bypass, and resistance to direct attack. Assurance requirements include development processes, procedures, and methodologies as well as the evidence from development and assessment activities that provide grounds for confidence that the required functionality is implemented and possesses the required strength of mechanism. [SP 800-160-1](#e3cc0520-a366-4fc9-abc2-5272db7e3564) describes the process of requirements engineering as part of the system development life cycle.

Controls can be viewed as descriptions of the safeguards and protection capabilities appropriate for achieving the particular security and privacy objectives of the organization and for reflecting the security and privacy requirements of stakeholders. Controls are selected and implemented in order to satisfy system requirements and include developer and organizational responsibilities. Controls can include technical, administrative, and physical aspects. In some cases, the selection and implementation of a control may necessitate additional specification by the organization in the form of derived requirements or instantiated control parameter values. The derived requirements and control parameter values may be necessary to provide the appropriate level of implementation detail for controls within the system development life cycle.

Security and privacy documentation requirements address all stages of the system development life cycle. Documentation provides user and administrator guidance for the implementation and operation of controls. The level of detail required in such documentation is based on the security categorization or classification level of the system and the degree to which organizations depend on the capabilities, functions, or mechanisms to meet risk response expectations. Requirements can include mandated configuration settings that specify allowed functions, ports, protocols, and services. Acceptance criteria for systems, system components, and system services are defined in the same manner as the criteria for any organizational acquisition or procurement.

Organizations can determine other requirements that support security and operations, to include responsibilities for the organization and developer, and notification and timing requirements for support, maintenance and updates.

## What to Check

- [ ] Verify SA-4 Acquisition Process is documented in SSP
- [ ] Validate all 8 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-4 implementation details. Verify the organization has documented how this control is satisfied.

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

Include the following requirements, descriptions, and criteria, explicitly or by reference, using [organization-defined] in the acquisition contract for the system, system component, or system service:
Security and privacy functional requirements;
Strength of mechanism requirements;
Security and privacy assurance requirements;
Controls needed to satisfy the security and privacy requirements.
Security and privacy documentation requirements;
Requirements for protecting security and privacy documentation;
Description of the system development environment and environment in which the system is intended to operate;
Allocation of responsibility or identification of parties responsible for information security, privacy, and supply chain risk management; and
Acceptance criteria.

### Implementation Guidance

Security and privacy functional requirements are typically derived from the high-level security and privacy requirements described in [SA-2](#sa-2) . The derived requirements include security and privacy capabilities, functions, and mechanisms. Strength requirements associated with such capabilities, functions, and mechanisms include degree of correctness, completeness, resistance to tampering or bypass, and resistance to direct attack. Assurance requirements include development processes, procedures, and methodologies as well as the evidence from development and assessment activities that provide grounds for confidence that the required functionality is implemented and possesses the required strength of mechanism. [SP 800-160-1](#e3cc0520-a366-4fc9-abc2-5272db7e3564) describes the process of requirements engineering as part of the system development life cycle.

Controls can be viewed as descriptions of the safeguards and protection capabilities appropriate for achieving the particular security and privacy objectives of the organization and for reflecting the security and privacy requirements of stakeholders. Controls are selected and implemented in order to satisfy system requirements and include developer and organizational responsibilities. Controls can include technical, administrative, and physical aspects. In some cases, the selection and implementation of a control may necessitate additional specification by the organization in the form of derived requirements or instantiated control parameter values. The derived requirements and control parameter values may be necessary to provide the appropriate level of implementation detail for controls within the system development life cycle.

Security and privacy documentation requirements address all stages of the system development life cycle. Documentation provides user and administrator guidance for the implementation and operation of controls. The level of detail required in such documentation is based on the security categorization or classification level of the system and the degree to which organizations depend on the capabilities, functions, or mechanisms to meet risk response expectations. Requirements can include mandated configuration settings that specify allowed functions, ports, protocols, and services. Acceptance criteria for systems, system components, and system services are defined in the same manner as the criteria for any organizational acquisition or procurement.

Organizations can determine other requirements that support security and operations, to include responsibilities for the organization and developer, and notification and timing requirements for support, maintenance and updates.

## Risk Assessment

| Finding                                  | Severity | Impact                                     |
| ---------------------------------------- | -------- | ------------------------------------------ |
| SA-4 Acquisition Process not implemented | Medium   | System and Services Acquisition            |
| SA-4 partially implemented               | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-4](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-6, CM-8, PS-7, SA-3, SA-5) reviewed
