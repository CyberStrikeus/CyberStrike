---
name: "SR-4(3)_validate-as-genuine-and-not-altered"
description: "Employ the following controls to validate that the system or system component received is genuine and has not been altered: [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-4-3
  - sr
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AT-3
  - SR-9
  - SR-10
  - SR-11
prerequisites:
  - SR-4
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  SR-9: "Chain with SR-9 for comprehensive security coverage"
  SR-10: "Chain with SR-10 for comprehensive security coverage"
---

# SR-4(3) Validate as Genuine and Not Altered

> **Enhancement of:** SR-4

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

For many systems and system components, especially hardware, there are technical means to determine if the items are genuine or have been altered, including optical and nanotechnology tagging, physically unclonable functions, side-channel analysis, cryptographic hash verifications or digital signatures, and visible anti-tamper labels or stickers. Controls can also include monitoring for out of specification performance, which can be an indicator of tampering or counterfeits. Organizations may leverage supplier and contractor processes for validating that a system or component is genuine and has not been altered and for replacing a suspect system or component. Some indications of tampering may be visible and addressable before accepting delivery, such as inconsistent packaging, broken seals, and incorrect labels. When a system or system component is suspected of being altered or counterfeit, the supplier, contractor, or original equipment manufacturer may be able to replace the item or provide a forensic capability to determine the origin of the counterfeit or altered item. Organizations can provide training to personnel on how to identify suspicious system or component deliveries.

## What to Check

- [ ] Verify SR-4(3) Validate as Genuine and Not Altered is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-4(3)
- [ ] Verify enhancement builds upon base control SR-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-4(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ the following controls to validate that the system or system component received is genuine and has not been altered: [organization-defined].

### Implementation Guidance

For many systems and system components, especially hardware, there are technical means to determine if the items are genuine or have been altered, including optical and nanotechnology tagging, physically unclonable functions, side-channel analysis, cryptographic hash verifications or digital signatures, and visible anti-tamper labels or stickers. Controls can also include monitoring for out of specification performance, which can be an indicator of tampering or counterfeits. Organizations may leverage supplier and contractor processes for validating that a system or component is genuine and has not been altered and for replacing a suspect system or component. Some indications of tampering may be visible and addressable before accepting delivery, such as inconsistent packaging, broken seals, and incorrect labels. When a system or system component is suspected of being altered or counterfeit, the supplier, contractor, or original equipment manufacturer may be able to replace the item or provide a forensic capability to determine the origin of the counterfeit or altered item. Organizations can provide training to personnel on how to identify suspicious system or component deliveries.

## Risk Assessment

| Finding                                                     | Severity | Impact                                  |
| ----------------------------------------------------------- | -------- | --------------------------------------- |
| SR-4(3) Validate as Genuine and Not Altered not implemented | Medium   | Supply Chain Risk Management            |
| SR-4(3) partially implemented                               | Low      | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-4(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-4.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3, SR-9, SR-10, SR-11) reviewed
