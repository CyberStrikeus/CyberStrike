---
name: "PS-4(1)_post-employment-requirements"
description: "Notify terminated individuals of applicable, legally binding post-employment requirements for the protection of organizational information;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-4-1
  - ps
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - PS-4
severity_boost: {}
---

# PS-4(1) Post-employment Requirements

> **Enhancement of:** PS-4

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

Organizations consult with the Office of the General Counsel regarding matters of post-employment requirements on terminated individuals.

## What to Check

- [ ] Verify PS-4(1) Post-employment Requirements is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-4(1)
- [ ] Verify enhancement builds upon base control PS-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-4(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Notify terminated individuals of applicable, legally binding post-employment requirements for the protection of organizational information; and
Require terminated individuals to sign an acknowledgment of post-employment requirements as part of the organizational termination process.

### Implementation Guidance

Organizations consult with the Office of the General Counsel regarding matters of post-employment requirements on terminated individuals.

## Risk Assessment

| Finding                                              | Severity | Impact                        |
| ---------------------------------------------------- | -------- | ----------------------------- |
| PS-4(1) Post-employment Requirements not implemented | Medium   | Personnel Security            |
| PS-4(1) partially implemented                        | Low      | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-4(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-4.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
