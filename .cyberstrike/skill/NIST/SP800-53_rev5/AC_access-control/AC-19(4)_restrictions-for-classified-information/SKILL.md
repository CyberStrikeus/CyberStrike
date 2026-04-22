---
name: "AC-19(4)_restrictions-for-classified-information"
description: "Prohibit the use of unclassified mobile devices in facilities containing systems processing, storing, or transmitting classified information unless..."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-19-4
  - ac
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - CM-8
  - IR-4
prerequisites:
  - AC-19
severity_boost:
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  IR-4: "Chain with IR-4 for comprehensive security coverage"
---

# AC-19(4) Restrictions for Classified Information

> **Enhancement of:** AC-19

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

None.

## What to Check

- [ ] Verify AC-19(4) Restrictions for Classified Information is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-19(4)
- [ ] Verify enhancement builds upon base control AC-19

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-19(4) implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test web application access controls | `browser_auth_test` |

## Remediation Guide

### Control Statement

Prohibit the use of unclassified mobile devices in facilities containing systems processing, storing, or transmitting classified information unless specifically permitted by the authorizing official; and
Enforce the following restrictions on individuals permitted by the authorizing official to use unclassified mobile devices in facilities containing systems processing, storing, or transmitting classified information:
Connection of unclassified mobile devices to classified systems is prohibited;
Connection of unclassified mobile devices to unclassified systems requires approval from the authorizing official;
Use of internal or external modems or wireless interfaces within the unclassified mobile devices is prohibited; and
Unclassified mobile devices and the information stored on those devices are subject to random reviews and inspections by [organization-defined] , and if classified information is found, the incident handling policy is followed.
Restrict the connection of classified mobile devices to classified systems in accordance with [organization-defined].

### Implementation Guidance

None.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AC-19(4) Restrictions for Classified Information not implemented | High | Access Control |
| AC-19(4) partially implemented | Medium | Incomplete Access Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-53 Rev 5 - AC-19(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-19.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-8, IR-4) reviewed
