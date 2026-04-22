---
name: "AC-6_least-privilege"
description: "Employ the principle of least privilege, allowing only authorized accesses for users (or processes acting on behalf of users) that are necessary to ac"
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-6
  - ac
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - AC-2
  - AC-3
  - AC-5
  - AC-16
  - CM-5
  - CM-11
  - PL-2
  - PM-12
  - SA-8
  - SA-15
prerequisites: []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-5: "Chain with AC-5 for comprehensive security coverage"
---

# AC-6 Least Privilege

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Organizations employ least privilege for specific duties and systems. The principle of least privilege is also applied to system processes, ensuring that the processes have access to systems and operate at privilege levels no higher than necessary to accomplish organizational missions or business functions. Organizations consider the creation of additional processes, roles, and accounts as necessary to achieve least privilege. Organizations apply least privilege to the development, implementation, and operation of organizational systems.

## What to Check

- [ ] Verify AC-6 Least Privilege is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-6 implementation details. Verify the organization has documented how this control is satisfied.

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

Employ the principle of least privilege, allowing only authorized accesses for users (or processes acting on behalf of users) that are necessary to accomplish assigned organizational tasks.

### Implementation Guidance

Organizations employ least privilege for specific duties and systems. The principle of least privilege is also applied to system processes, ensuring that the processes have access to systems and operate at privilege levels no higher than necessary to accomplish organizational missions or business functions. Organizations consider the creation of additional processes, roles, and accounts as necessary to achieve least privilege. Organizations apply least privilege to the development, implementation, and operation of organizational systems.

## Risk Assessment

| Finding                              | Severity | Impact                    |
| ------------------------------------ | -------- | ------------------------- |
| AC-6 Least Privilege not implemented | High     | Access Control            |
| AC-6 partially implemented           | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-6](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-3, AC-5, AC-16, CM-5) reviewed
