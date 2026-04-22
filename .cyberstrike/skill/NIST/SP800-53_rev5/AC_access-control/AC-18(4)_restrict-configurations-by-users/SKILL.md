---
name: "AC-18(4)_restrict-configurations-by-users"
description: "Identify and explicitly authorize users allowed to independently configure wireless networking capabilities."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-18-4
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
  - SC-7
  - SC-15
prerequisites:
  - AC-18
severity_boost:
  SC-7: "Chain with SC-7 for comprehensive security coverage"
  SC-15: "Chain with SC-15 for comprehensive security coverage"
---

# AC-18(4) Restrict Configurations by Users

> **Enhancement of:** AC-18

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Organizational authorizations to allow selected users to configure wireless networking capabilities are enforced, in part, by the access enforcement mechanisms employed within organizational systems.

## What to Check

- [ ] Verify AC-18(4) Restrict Configurations by Users is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-18(4)
- [ ] Verify enhancement builds upon base control AC-18

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-18(4) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                                | Usage                      |
| --------------- | -------------------------------------- | -------------------------- |
| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test web application access controls   | `browser_auth_test`        |

## Remediation Guide

### Control Statement

Identify and explicitly authorize users allowed to independently configure wireless networking capabilities.

### Implementation Guidance

Organizational authorizations to allow selected users to configure wireless networking capabilities are enforced, in part, by the access enforcement mechanisms employed within organizational systems.

## Risk Assessment

| Finding                                                   | Severity | Impact                    |
| --------------------------------------------------------- | -------- | ------------------------- |
| AC-18(4) Restrict Configurations by Users not implemented | High     | Access Control            |
| AC-18(4) partially implemented                            | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-18(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-18.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SC-7, SC-15) reviewed
