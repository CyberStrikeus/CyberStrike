---
name: "MP-8(3)_controlled-unclassified-information"
description: "Downgrade system media containing controlled unclassified information prior to public release."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - mp-8-3
  - mp
  - enhancement
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with: []
prerequisites:
  - MP-8
severity_boost: {}
---

# MP-8(3) Controlled Unclassified Information

> **Enhancement of:** MP-8

## High-Level Description

**Family:** Media Protection (MP)
**Framework:** NIST SP 800-53 Rev 5

The downgrading of controlled unclassified information uses approved sanitization tools, techniques, and procedures.

## What to Check

- [ ] Verify MP-8(3) Controlled Unclassified Information is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MP-8(3)
- [ ] Verify enhancement builds upon base control MP-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MP-8(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Downgrade system media containing controlled unclassified information prior to public release.

### Implementation Guidance

The downgrading of controlled unclassified information uses approved sanitization tools, techniques, and procedures.

## Risk Assessment

| Finding                                                     | Severity | Impact                      |
| ----------------------------------------------------------- | -------- | --------------------------- |
| MP-8(3) Controlled Unclassified Information not implemented | Medium   | Media Protection            |
| MP-8(3) partially implemented                               | Low      | Incomplete Media Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MP-8(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=mp-8.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
