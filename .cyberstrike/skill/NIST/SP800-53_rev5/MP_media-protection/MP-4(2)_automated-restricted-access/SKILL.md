---
name: "MP-4(2)_automated-restricted-access"
description: "Restrict access to media storage areas and log access attempts and access granted using [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - mp-4-2
  - mp
  - enhancement
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with:
  - AC-3
  - AU-2
  - AU-6
  - AU-9
  - AU-12
  - PE-3
prerequisites:
  - MP-4
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
---

# MP-4(2) Automated Restricted Access

> **Enhancement of:** MP-4

## High-Level Description

**Family:** Media Protection (MP)
**Framework:** NIST SP 800-53 Rev 5

Automated mechanisms include keypads, biometric readers, or card readers on the external entries to media storage areas.

## What to Check

- [ ] Verify MP-4(2) Automated Restricted Access is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MP-4(2)
- [ ] Verify enhancement builds upon base control MP-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MP-4(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Restrict access to media storage areas and log access attempts and access granted using [organization-defined].

### Implementation Guidance

Automated mechanisms include keypads, biometric readers, or card readers on the external entries to media storage areas.

## Risk Assessment

| Finding                                             | Severity | Impact                      |
| --------------------------------------------------- | -------- | --------------------------- |
| MP-4(2) Automated Restricted Access not implemented | Medium   | Media Protection            |
| MP-4(2) partially implemented                       | Low      | Incomplete Media Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MP-4(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=mp-4.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, AU-2, AU-6, AU-9, AU-12) reviewed
