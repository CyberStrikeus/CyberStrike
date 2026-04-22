---
name: "PM-7_enterprise-architecture"
description: "Develop and maintain an enterprise architecture with consideration for information security, privacy, and the resulting risk to organizational operati"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-7
  - pm
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AU-6
  - PL-2
  - PL-8
  - PM-11
  - RA-2
  - SA-3
  - SA-8
  - SA-17
prerequisites: []
severity_boost:
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  PL-2: "Chain with PL-2 for comprehensive security coverage"
  PL-8: "Chain with PL-8 for comprehensive security coverage"
---

# PM-7 Enterprise Architecture

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

The integration of security and privacy requirements and controls into the enterprise architecture helps to ensure that security and privacy considerations are addressed throughout the system development life cycle and are explicitly related to the organization’s mission and business processes. The process of security and privacy requirements integration also embeds into the enterprise architecture and the organization’s security and privacy architectures consistent with the organizational risk management strategy. For PM-7, security and privacy architectures are developed at a system-of-systems level, representing all organizational systems. For [PL-8](#pl-8) , the security and privacy architectures are developed at a level that represents an individual system. The system-level architectures are consistent with the security and privacy architectures defined for the organization. Security and privacy requirements and control integration are most effectively accomplished through the rigorous application of the Risk Management Framework [SP 800-37](#482e4c99-9dc4-41ad-bba8-0f3f0032c1f8) and supporting security standards and guidelines.

## What to Check

- [ ] Verify PM-7 Enterprise Architecture is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-7 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop and maintain an enterprise architecture with consideration for information security, privacy, and the resulting risk to organizational operations and assets, individuals, other organizations, and the Nation.

### Implementation Guidance

The integration of security and privacy requirements and controls into the enterprise architecture helps to ensure that security and privacy considerations are addressed throughout the system development life cycle and are explicitly related to the organization’s mission and business processes. The process of security and privacy requirements integration also embeds into the enterprise architecture and the organization’s security and privacy architectures consistent with the organizational risk management strategy. For PM-7, security and privacy architectures are developed at a system-of-systems level, representing all organizational systems. For [PL-8](#pl-8) , the security and privacy architectures are developed at a level that represents an individual system. The system-level architectures are consistent with the security and privacy architectures defined for the organization. Security and privacy requirements and control integration are most effectively accomplished through the rigorous application of the Risk Management Framework [SP 800-37](#482e4c99-9dc4-41ad-bba8-0f3f0032c1f8) and supporting security standards and guidelines.

## Risk Assessment

| Finding                                      | Severity | Impact                        |
| -------------------------------------------- | -------- | ----------------------------- |
| PM-7 Enterprise Architecture not implemented | Medium   | Program Management            |
| PM-7 partially implemented                   | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-7](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-6, PL-2, PL-8, PM-11, RA-2) reviewed
