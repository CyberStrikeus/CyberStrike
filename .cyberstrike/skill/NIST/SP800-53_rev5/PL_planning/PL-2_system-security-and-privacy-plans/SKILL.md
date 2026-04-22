---
name: "PL-2_system-security-and-privacy-plans"
description: "Develop security and privacy plans for the system that: Are consistent with the organization’s enterprise architecture; Explicitly define the constitu"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pl-2
  - pl
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AC-2
  - AC-6
  - AC-14
  - AC-17
  - AC-20
  - CA-2
  - CA-3
  - CA-7
  - CM-9
  - CM-13
prerequisites:
  []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-6: "Chain with AC-6 for comprehensive security coverage"
  AC-14: "Chain with AC-14 for comprehensive security coverage"
---

# PL-2 System Security and Privacy Plans

## High-Level Description

**Family:** Planning (PL)
**Framework:** NIST SP 800-53 Rev 5

System security and privacy plans are scoped to the system and system components within the defined authorization boundary and contain an overview of the security and privacy requirements for the system and the controls selected to satisfy the requirements. The plans describe the intended application of each selected control in the context of the system with a sufficient level of detail to correctly implement the control and to subsequently assess the effectiveness of the control. The control documentation describes how system-specific and hybrid controls are implemented and the plans and expectations regarding the functionality of the system. System security and privacy plans can also be used in the design and development of systems in support of life cycle-based security and privacy engineering processes. System security and privacy plans are living documents that are updated and adapted throughout the system development life cycle (e.g., during capability determination, analysis of alternatives, requests for proposal, and design reviews). [Section 2.1](#c3397cc9-83c6-4459-adb2-836739dc1b94) describes the different types of requirements that are relevant to organizations during the system development life cycle and the relationship between requirements and controls.

Organizations may develop a single, integrated security and privacy plan or maintain separate plans. Security and privacy plans relate security and privacy requirements to a set of controls and control enhancements. The plans describe how the controls and control enhancements meet the security and privacy requirements but do not provide detailed, technical descriptions of the design or implementation of the controls and control enhancements. Security and privacy plans contain sufficient information (including specifications of control parameter values for selection and assignment operations explicitly or by reference) to enable a design and implementation that is unambiguously compliant with the intent of the plans and subsequent determinations of risk to organizational operations and assets, individuals, other organizations, and the Nation if the plan is implemented.

Security and privacy plans need not be single documents. The plans can be a collection of various documents, including documents that already exist. Effective security and privacy plans make extensive use of references to policies, procedures, and additional documents, including design and implementation specifications where more detailed information can be obtained. The use of references helps reduce the documentation associated with security and privacy programs and maintains the security- and privacy-related information in other established management and operational areas, including enterprise architecture, system development life cycle, systems engineering, and acquisition. Security and privacy plans need not contain detailed contingency plan or incident response plan information but can instead provide—explicitly or by reference—sufficient information to define what needs to be accomplished by those plans.

Security- and privacy-related activities that may require coordination and planning with other individuals or groups within the organization include assessments, audits, inspections, hardware and software maintenance, acquisition and supply chain risk management, patch management, and contingency plan testing. Planning and coordination include emergency and nonemergency (i.e., planned or non-urgent unplanned) situations. The process defined by organizations to plan and coordinate security- and privacy-related activities can also be included in other documents, as appropriate.

## What to Check

- [ ] Verify PL-2 System Security and Privacy Plans is documented in SSP
- [ ] Validate all 18 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PL-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PL-2 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop security and privacy plans for the system that:
Are consistent with the organization’s enterprise architecture;
Explicitly define the constituent system components;
Describe the operational context of the system in terms of mission and business processes;
Identify the individuals that fulfill system roles and responsibilities;
Identify the information types processed, stored, and transmitted by the system;
Provide the security categorization of the system, including supporting rationale;
Describe any specific threats to the system that are of concern to the organization;
Provide the results of a privacy risk assessment for systems processing personally identifiable information;
Describe the operational environment for the system and any dependencies on or connections to other systems or system components;
Provide an overview of the security and privacy requirements for the system;
Identify any relevant control baselines or overlays, if applicable;
Describe the controls in place or planned for meeting the security and privacy requirements, including a rationale for any tailoring decisions;
Include risk determinations for security and privacy architecture and design decisions;
Include security- and privacy-related activities affecting the system that require planning and coordination with [organization-defined] ; and
Are reviewed and approved by the authorizing official or designated representative prior to plan implementation.
Distribute copies of the plans and communicate subsequent changes to the plans to [organization-defined];
Review the plans [organization-defined];
Update the plans to address changes to the system and environment of operation or problems identified during plan implementation or control assessments; and
Protect the plans from unauthorized disclosure and modification.

### Implementation Guidance

System security and privacy plans are scoped to the system and system components within the defined authorization boundary and contain an overview of the security and privacy requirements for the system and the controls selected to satisfy the requirements. The plans describe the intended application of each selected control in the context of the system with a sufficient level of detail to correctly implement the control and to subsequently assess the effectiveness of the control. The control documentation describes how system-specific and hybrid controls are implemented and the plans and expectations regarding the functionality of the system. System security and privacy plans can also be used in the design and development of systems in support of life cycle-based security and privacy engineering processes. System security and privacy plans are living documents that are updated and adapted throughout the system development life cycle (e.g., during capability determination, analysis of alternatives, requests for proposal, and design reviews). [Section 2.1](#c3397cc9-83c6-4459-adb2-836739dc1b94) describes the different types of requirements that are relevant to organizations during the system development life cycle and the relationship between requirements and controls.

Organizations may develop a single, integrated security and privacy plan or maintain separate plans. Security and privacy plans relate security and privacy requirements to a set of controls and control enhancements. The plans describe how the controls and control enhancements meet the security and privacy requirements but do not provide detailed, technical descriptions of the design or implementation of the controls and control enhancements. Security and privacy plans contain sufficient information (including specifications of control parameter values for selection and assignment operations explicitly or by reference) to enable a design and implementation that is unambiguously compliant with the intent of the plans and subsequent determinations of risk to organizational operations and assets, individuals, other organizations, and the Nation if the plan is implemented.

Security and privacy plans need not be single documents. The plans can be a collection of various documents, including documents that already exist. Effective security and privacy plans make extensive use of references to policies, procedures, and additional documents, including design and implementation specifications where more detailed information can be obtained. The use of references helps reduce the documentation associated with security and privacy programs and maintains the security- and privacy-related information in other established management and operational areas, including enterprise architecture, system development life cycle, systems engineering, and acquisition. Security and privacy plans need not contain detailed contingency plan or incident response plan information but can instead provide—explicitly or by reference—sufficient information to define what needs to be accomplished by those plans.

Security- and privacy-related activities that may require coordination and planning with other individuals or groups within the organization include assessments, audits, inspections, hardware and software maintenance, acquisition and supply chain risk management, patch management, and contingency plan testing. Planning and coordination include emergency and nonemergency (i.e., planned or non-urgent unplanned) situations. The process defined by organizations to plan and coordinate security- and privacy-related activities can also be included in other documents, as appropriate.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PL-2 System Security and Privacy Plans not implemented | Medium | Planning |
| PL-2 partially implemented | Low | Incomplete Planning |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PL-2](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pl-2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-6, AC-14, AC-17, AC-20) reviewed
