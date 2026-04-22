---
name: "CM-3(7)_review-system-changes"
description: "Review changes to the system [organization-defined] or when [organization-defined] to determine whether unauthorized changes have occurred."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-3-7
  - cm
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  - AU-6
  - AU-7
  - CM-3
prerequisites:
  - CM-3
severity_boost:
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-7: "Chain with AU-7 for comprehensive security coverage"
  CM-3: "Chain with CM-3 for comprehensive security coverage"
---

# CM-3(7) Review System Changes

> **Enhancement of:** CM-3

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Indications that warrant a review of changes to the system and the specific circumstances justifying such reviews may be obtained from activities carried out by organizations during the configuration change process or continuous monitoring process.

## What to Check

- [ ] Verify CM-3(7) Review System Changes is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-3(7)
- [ ] Verify enhancement builds upon base control CM-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-3(7) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                       | Usage                                     |
| --------------- | ----------------------------- | ----------------------------------------- |
| cloud-audit-mcp | Check configuration baselines | `cloud_audit_config`                      |
| AWS CLI         | Review Config rules           | `aws configservice describe-config-rules` |

## Remediation Guide

### Control Statement

Review changes to the system [organization-defined] or when [organization-defined] to determine whether unauthorized changes have occurred.

### Implementation Guidance

Indications that warrant a review of changes to the system and the specific circumstances justifying such reviews may be obtained from activities carried out by organizations during the configuration change process or continuous monitoring process.

## Risk Assessment

| Finding                                       | Severity | Impact                              |
| --------------------------------------------- | -------- | ----------------------------------- |
| CM-3(7) Review System Changes not implemented | Medium   | Configuration Management            |
| CM-3(7) partially implemented                 | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-3(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-3.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-6, AU-7, CM-3) reviewed
