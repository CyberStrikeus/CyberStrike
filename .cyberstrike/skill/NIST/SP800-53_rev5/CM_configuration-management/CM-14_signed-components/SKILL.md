---
name: "CM-14_signed-components"
description: "Prevent the installation of [organization-defined] without verification that the component has been digitally signed using a certificate that is recog"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-14
  - cm
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  - CM-7
  - SC-12
  - SC-13
  - SI-7
prerequisites:
  []
severity_boost:
  CM-7: "Chain with CM-7 for comprehensive security coverage"
  SC-12: "Chain with SC-12 for comprehensive security coverage"
  SC-13: "Chain with SC-13 for comprehensive security coverage"
---

# CM-14 Signed Components

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Software and firmware components prevented from installation unless signed with recognized and approved certificates include software and firmware version updates, patches, service packs, device drivers, and basic input/output system updates. Organizations can identify applicable software and firmware components by type, by specific items, or a combination of both. Digital signatures and organizational verification of such signatures is a method of code authentication.

## What to Check

- [ ] Verify CM-14 Signed Components is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-14

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-14 implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check configuration baselines | `cloud_audit_config` |
| AWS CLI | Review Config rules | `aws configservice describe-config-rules` |

## Remediation Guide

### Control Statement

Prevent the installation of [organization-defined] without verification that the component has been digitally signed using a certificate that is recognized and approved by the organization.

### Implementation Guidance

Software and firmware components prevented from installation unless signed with recognized and approved certificates include software and firmware version updates, patches, service packs, device drivers, and basic input/output system updates. Organizations can identify applicable software and firmware components by type, by specific items, or a combination of both. Digital signatures and organizational verification of such signatures is a method of code authentication.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-14 Signed Components not implemented | Medium | Configuration Management |
| CM-14 partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-14](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-14)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-7, SC-12, SC-13, SI-7) reviewed
