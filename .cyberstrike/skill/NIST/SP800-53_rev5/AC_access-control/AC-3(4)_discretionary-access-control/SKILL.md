---
name: "AC-3(4)_discretionary-access-control"
description: "Enforce [organization-defined] over the set of covered subjects and objects specified in the policy, and where the policy specifies that a subject tha"
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-3-4
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
chains_with: []
prerequisites:
  - AC-3
severity_boost: {}
---

# AC-3(4) Discretionary Access Control

> **Enhancement of:** AC-3

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

When discretionary access control policies are implemented, subjects are not constrained with regard to what actions they can take with information for which they have already been granted access. Thus, subjects that have been granted access to information are not prevented from passing the information to other subjects or objects (i.e., subjects have the discretion to pass). Discretionary access control can operate in conjunction with mandatory access control as described in [AC-3(3)](#ac-3.3) and [AC-3(15)](#ac-3.15) . A subject that is constrained in its operation by mandatory access control policies can still operate under the less rigorous constraints of discretionary access control. Therefore, while [AC-3(3)](#ac-3.3) imposes constraints that prevent a subject from passing information to another subject operating at a different impact or classification level, [AC-3(4)](#ac-3.4) permits the subject to pass the information to any subject at the same impact or classification level. The policy is bounded by the system. Once the information is passed outside of system control, additional means may be required to ensure that the constraints remain in effect. While traditional definitions of discretionary access control require identity-based access control, that limitation is not required for this particular use of discretionary access control.

## What to Check

- [ ] Verify AC-3(4) Discretionary Access Control is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-3(4)
- [ ] Verify enhancement builds upon base control AC-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-3(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Enforce [organization-defined] over the set of covered subjects and objects specified in the policy, and where the policy specifies that a subject that has been granted access to information can do one or more of the following:
Pass the information to any other subjects or objects;
Grant its privileges to other subjects;
Change security attributes on subjects, objects, the system, or the system’s components;
Choose the security attributes to be associated with newly created or revised objects; or
Change the rules governing access control.

### Implementation Guidance

When discretionary access control policies are implemented, subjects are not constrained with regard to what actions they can take with information for which they have already been granted access. Thus, subjects that have been granted access to information are not prevented from passing the information to other subjects or objects (i.e., subjects have the discretion to pass). Discretionary access control can operate in conjunction with mandatory access control as described in [AC-3(3)](#ac-3.3) and [AC-3(15)](#ac-3.15) . A subject that is constrained in its operation by mandatory access control policies can still operate under the less rigorous constraints of discretionary access control. Therefore, while [AC-3(3)](#ac-3.3) imposes constraints that prevent a subject from passing information to another subject operating at a different impact or classification level, [AC-3(4)](#ac-3.4) permits the subject to pass the information to any subject at the same impact or classification level. The policy is bounded by the system. Once the information is passed outside of system control, additional means may be required to ensure that the constraints remain in effect. While traditional definitions of discretionary access control require identity-based access control, that limitation is not required for this particular use of discretionary access control.

## Risk Assessment

| Finding                                              | Severity | Impact                    |
| ---------------------------------------------------- | -------- | ------------------------- |
| AC-3(4) Discretionary Access Control not implemented | High     | Access Control            |
| AC-3(4) partially implemented                        | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-3(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-3.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
