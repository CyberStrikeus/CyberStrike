---
name: "SA-9(1)_risk-assessments-and-organizational-approvals"
description: "Conduct an organizational assessment of risk prior to the acquisition or outsourcing of information security services;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-9-1
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CA-6
  - RA-3
  - RA-8
prerequisites:
  - SA-9
severity_boost:
  CA-6: "Chain with CA-6 for comprehensive security coverage"
  RA-3: "Chain with RA-3 for comprehensive security coverage"
  RA-8: "Chain with RA-8 for comprehensive security coverage"
---

# SA-9(1) Risk Assessments and Organizational Approvals

> **Enhancement of:** SA-9

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Information security services include the operation of security devices, such as firewalls or key management services as well as incident monitoring, analysis, and response. Risks assessed can include system, mission or business, security, privacy, or supply chain risks.

## What to Check

- [ ] Verify SA-9(1) Risk Assessments and Organizational Approvals is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-9(1)
- [ ] Verify enhancement builds upon base control SA-9

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-9(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Conduct an organizational assessment of risk prior to the acquisition or outsourcing of information security services; and
Verify that the acquisition or outsourcing of dedicated information security services is approved by [organization-defined].

### Implementation Guidance

Information security services include the operation of security devices, such as firewalls or key management services as well as incident monitoring, analysis, and response. Risks assessed can include system, mission or business, security, privacy, or supply chain risks.

## Risk Assessment

| Finding                                                               | Severity | Impact                                     |
| --------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-9(1) Risk Assessments and Organizational Approvals not implemented | Medium   | System and Services Acquisition            |
| SA-9(1) partially implemented                                         | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-9(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-9.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-6, RA-3, RA-8) reviewed
