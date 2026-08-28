---
name: "PS-6(2)_classified-information-requiring-special-protection"
description: "Verify that access to classified information requiring special protection is granted only to individuals who: Have a valid access authorization that i"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-6-2
  - ps
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - PS-6
severity_boost: {}
---

# PS-6(2) Classified Information Requiring Special Protection

> **Enhancement of:** PS-6

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

Classified information that requires special protection includes collateral information, Special Access Program (SAP) information, and Sensitive Compartmented Information (SCI). Personnel security criteria reflect applicable laws, executive orders, directives, regulations, policies, standards, and guidelines.

## What to Check

- [ ] Verify PS-6(2) Classified Information Requiring Special Protection is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-6(2)
- [ ] Verify enhancement builds upon base control PS-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-6(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Verify that access to classified information requiring special protection is granted only to individuals who:
Have a valid access authorization that is demonstrated by assigned official government duties;
Satisfy associated personnel security criteria; and
Have read, understood, and signed a nondisclosure agreement.

### Implementation Guidance

Classified information that requires special protection includes collateral information, Special Access Program (SAP) information, and Sensitive Compartmented Information (SCI). Personnel security criteria reflect applicable laws, executive orders, directives, regulations, policies, standards, and guidelines.

## Risk Assessment

| Finding                                                                     | Severity | Impact                        |
| --------------------------------------------------------------------------- | -------- | ----------------------------- |
| PS-6(2) Classified Information Requiring Special Protection not implemented | Medium   | Personnel Security            |
| PS-6(2) partially implemented                                               | Low      | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-6(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-6.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
