---
name: "AC-4(17)_domain-authentication"
description: "Uniquely identify and authenticate source and destination points by [organization-defined] for information transfer."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-4-17
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
  - IA-2
  - IA-3
  - IA-9
prerequisites:
  - AC-4
severity_boost:
  IA-2: "Chain with IA-2 for comprehensive security coverage"
  IA-3: "Chain with IA-3 for comprehensive security coverage"
  IA-9: "Chain with IA-9 for comprehensive security coverage"
---

# AC-4(17) Domain Authentication

> **Enhancement of:** AC-4

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Attribution is a critical component of a security and privacy concept of operations. The ability to identify source and destination points for information flowing within systems allows the forensic reconstruction of events and encourages policy compliance by attributing policy violations to specific organizations or individuals. Successful domain authentication requires that system labels distinguish among systems, organizations, and individuals involved in preparing, sending, receiving, or disseminating information. Attribution also allows organizations to better maintain the lineage of personally identifiable information processing as it flows through systems and can facilitate consent tracking, as well as correction, deletion, or access requests from individuals.

## What to Check

- [ ] Verify AC-4(17) Domain Authentication is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-4(17)
- [ ] Verify enhancement builds upon base control AC-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-4(17) implementation details. Verify the organization has documented how this control is satisfied.

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

Uniquely identify and authenticate source and destination points by [organization-defined] for information transfer.

### Implementation Guidance

Attribution is a critical component of a security and privacy concept of operations. The ability to identify source and destination points for information flowing within systems allows the forensic reconstruction of events and encourages policy compliance by attributing policy violations to specific organizations or individuals. Successful domain authentication requires that system labels distinguish among systems, organizations, and individuals involved in preparing, sending, receiving, or disseminating information. Attribution also allows organizations to better maintain the lineage of personally identifiable information processing as it flows through systems and can facilitate consent tracking, as well as correction, deletion, or access requests from individuals.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AC-4(17) Domain Authentication not implemented | High | Access Control |
| AC-4(17) partially implemented | Medium | Incomplete Access Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-53 Rev 5 - AC-4(17)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-4.17)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IA-2, IA-3, IA-9) reviewed
