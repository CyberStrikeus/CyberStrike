---
name: "AC-20(5)_portable-storage-devices-prohibited-use"
description: "Prohibit the use of organization-controlled portable storage devices by authorized individuals on external systems."
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-20-5
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
  - MP-7
  - PL-4
  - PS-6
  - SC-41
prerequisites:
  - AC-20
severity_boost:
  MP-7: "Chain with MP-7 for comprehensive security coverage"
  PL-4: "Chain with PL-4 for comprehensive security coverage"
  PS-6: "Chain with PS-6 for comprehensive security coverage"
---

# AC-20(5) Portable Storage Devices — Prohibited Use

> **Enhancement of:** AC-20

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Limits on the use of organization-controlled portable storage devices in external systems include a complete prohibition of the use of such devices. Prohibiting such use is enforced using technical methods and/or nontechnical (i.e., process-based) methods.

## What to Check

- [ ] Verify AC-20(5) Portable Storage Devices — Prohibited Use is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-20(5)
- [ ] Verify enhancement builds upon base control AC-20

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-20(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Prohibit the use of organization-controlled portable storage devices by authorized individuals on external systems.

### Implementation Guidance

Limits on the use of organization-controlled portable storage devices in external systems include a complete prohibition of the use of such devices. Prohibiting such use is enforced using technical methods and/or nontechnical (i.e., process-based) methods.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AC-20(5) Portable Storage Devices — Prohibited Use not implemented | High | Access Control |
| AC-20(5) partially implemented | Medium | Incomplete Access Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST SP 800-53 Rev 5 - AC-20(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-20.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (MP-7, PL-4, PS-6, SC-41) reviewed
