---
name: "AC-9_previous-logon-notification"
description: "Notify the user, upon successful logon to the system, of the date and time of the last logon."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-9
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
  - AC-7
  - PL-4
prerequisites: []
severity_boost:
  AC-7: "Chain with AC-7 for comprehensive security coverage"
  PL-4: "Chain with PL-4 for comprehensive security coverage"
---

# AC-9 Previous Logon Notification

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Previous logon notification is applicable to system access via human user interfaces and access to systems that occurs in other types of architectures. Information about the last successful logon allows the user to recognize if the date and time provided is not consistent with the user’s last access.

## What to Check

- [ ] Verify AC-9 Previous Logon Notification is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-9

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-9 implementation details. Verify the organization has documented how this control is satisfied.

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

Notify the user, upon successful logon to the system, of the date and time of the last logon.

### Implementation Guidance

Previous logon notification is applicable to system access via human user interfaces and access to systems that occurs in other types of architectures. Information about the last successful logon allows the user to recognize if the date and time provided is not consistent with the user’s last access.

## Risk Assessment

| Finding                                          | Severity | Impact                    |
| ------------------------------------------------ | -------- | ------------------------- |
| AC-9 Previous Logon Notification not implemented | High     | Access Control            |
| AC-9 partially implemented                       | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-9](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-9)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-7, PL-4) reviewed
