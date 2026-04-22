---
name: "RA-3(1)_supply-chain-risk-assessment"
description: "Assess supply chain risks associated with [organization-defined] ;"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ra-3-1
  - ra
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - RA-2
  - RA-9
  - PM-17
  - PM-30
  - SR-2
prerequisites:
  - RA-3
severity_boost:
  RA-2: "Chain with RA-2 for comprehensive security coverage"
  RA-9: "Chain with RA-9 for comprehensive security coverage"
  PM-17: "Chain with PM-17 for comprehensive security coverage"
---

# RA-3(1) Supply Chain Risk Assessment

> **Enhancement of:** RA-3

## High-Level Description

**Family:** Risk Assessment (RA)
**Framework:** NIST SP 800-53 Rev 5

Supply chain-related events include disruption, use of defective components, insertion of counterfeits, theft, malicious development practices, improper delivery practices, and insertion of malicious code. These events can have a significant impact on the confidentiality, integrity, or availability of a system and its information and, therefore, can also adversely impact organizational operations (including mission, functions, image, or reputation), organizational assets, individuals, other organizations, and the Nation. The supply chain-related events may be unintentional or malicious and can occur at any point during the system life cycle. An analysis of supply chain risk can help an organization identify systems or components for which additional supply chain risk mitigations are required.

## What to Check

- [ ] Verify RA-3(1) Supply Chain Risk Assessment is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for RA-3(1)
- [ ] Verify enhancement builds upon base control RA-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for RA-3(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Assess supply chain risks associated with [organization-defined] ; and
Update the supply chain risk assessment [organization-defined] , when there are significant changes to the relevant supply chain, or when changes to the system, environments of operation, or other conditions may necessitate a change in the supply chain.

### Implementation Guidance

Supply chain-related events include disruption, use of defective components, insertion of counterfeits, theft, malicious development practices, improper delivery practices, and insertion of malicious code. These events can have a significant impact on the confidentiality, integrity, or availability of a system and its information and, therefore, can also adversely impact organizational operations (including mission, functions, image, or reputation), organizational assets, individuals, other organizations, and the Nation. The supply chain-related events may be unintentional or malicious and can occur at any point during the system life cycle. An analysis of supply chain risk can help an organization identify systems or components for which additional supply chain risk mitigations are required.

## Risk Assessment

| Finding                                              | Severity | Impact                     |
| ---------------------------------------------------- | -------- | -------------------------- |
| RA-3(1) Supply Chain Risk Assessment not implemented | Medium   | Risk Assessment            |
| RA-3(1) partially implemented                        | Low      | Incomplete Risk Assessment |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - RA-3(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ra-3.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (RA-2, RA-9, PM-17, PM-30, SR-2) reviewed
