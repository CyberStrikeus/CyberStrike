---
name: "AC-17(1)_monitoring-and-control"
description: "Employ automated mechanisms to monitor and control remote access methods."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-17-1
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
  - AU-2
  - AU-6
  - AU-12
  - AU-14
prerequisites:
  - AC-17
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-12: "Chain with AU-12 for comprehensive security coverage"
---

# AC-17(1) Monitoring and Control

> **Enhancement of:** AC-17

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Monitoring and control of remote access methods allows organizations to detect attacks and help ensure compliance with remote access policies by auditing the connection activities of remote users on a variety of system components, including servers, notebook computers, workstations, smart phones, and tablets. Audit logging for remote access is enforced by [AU-2](#au-2) . Audit events are defined in [AU-2a](#au-2_smt.a).

## What to Check

- [ ] Verify AC-17(1) Monitoring and Control is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-17(1)
- [ ] Verify enhancement builds upon base control AC-17

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-17(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ automated mechanisms to monitor and control remote access methods.

### Implementation Guidance

Monitoring and control of remote access methods allows organizations to detect attacks and help ensure compliance with remote access policies by auditing the connection activities of remote users on a variety of system components, including servers, notebook computers, workstations, smart phones, and tablets. Audit logging for remote access is enforced by [AU-2](#au-2) . Audit events are defined in [AU-2a](#au-2_smt.a).

## Risk Assessment

| Finding                                         | Severity | Impact                    |
| ----------------------------------------------- | -------- | ------------------------- |
| AC-17(1) Monitoring and Control not implemented | High     | Access Control            |
| AC-17(1) partially implemented                  | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-17(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-17.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-6, AU-12, AU-14) reviewed
