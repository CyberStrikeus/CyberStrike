---
name: "CM-6(2)_respond-to-unauthorized-changes"
description: "Take the following actions in response to unauthorized changes to [organization-defined]: [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-6-2
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
  - IR-4
  - IR-6
  - SI-7
prerequisites:
  - CM-6
severity_boost:
  IR-4: "Chain with IR-4 for comprehensive security coverage"
  IR-6: "Chain with IR-6 for comprehensive security coverage"
  SI-7: "Chain with SI-7 for comprehensive security coverage"
---

# CM-6(2) Respond to Unauthorized Changes

> **Enhancement of:** CM-6

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Responses to unauthorized changes to configuration settings include alerting designated organizational personnel, restoring established configuration settings, or—in extreme cases—halting affected system processing.

## What to Check

- [ ] Verify CM-6(2) Respond to Unauthorized Changes is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-6(2)
- [ ] Verify enhancement builds upon base control CM-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-6(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Take the following actions in response to unauthorized changes to [organization-defined]: [organization-defined].

### Implementation Guidance

Responses to unauthorized changes to configuration settings include alerting designated organizational personnel, restoring established configuration settings, or—in extreme cases—halting affected system processing.

## Risk Assessment

| Finding                                                 | Severity | Impact                              |
| ------------------------------------------------------- | -------- | ----------------------------------- |
| CM-6(2) Respond to Unauthorized Changes not implemented | Medium   | Configuration Management            |
| CM-6(2) partially implemented                           | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-6(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-6.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IR-4, IR-6, SI-7) reviewed
