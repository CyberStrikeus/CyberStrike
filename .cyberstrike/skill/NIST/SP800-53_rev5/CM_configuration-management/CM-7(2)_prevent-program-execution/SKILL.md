---
name: "CM-7(2)_prevent-program-execution"
description: "Prevent program execution in accordance with [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-7-2
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
  - CM-8
  - PL-4
  - PL-9
  - PM-5
  - PS-6
prerequisites:
  - CM-7
severity_boost:
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  PL-4: "Chain with PL-4 for comprehensive security coverage"
  PL-9: "Chain with PL-9 for comprehensive security coverage"
---

# CM-7(2) Prevent Program Execution

> **Enhancement of:** CM-7

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Prevention of program execution addresses organizational policies, rules of behavior, and/or access agreements that restrict software usage and the terms and conditions imposed by the developer or manufacturer, including software licensing and copyrights. Restrictions include prohibiting auto-execute features, restricting roles allowed to approve program execution, permitting or prohibiting specific software programs, or restricting the number of program instances executed at the same time.

## What to Check

- [ ] Verify CM-7(2) Prevent Program Execution is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-7(2)
- [ ] Verify enhancement builds upon base control CM-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-7(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Prevent program execution in accordance with [organization-defined].

### Implementation Guidance

Prevention of program execution addresses organizational policies, rules of behavior, and/or access agreements that restrict software usage and the terms and conditions imposed by the developer or manufacturer, including software licensing and copyrights. Restrictions include prohibiting auto-execute features, restricting roles allowed to approve program execution, permitting or prohibiting specific software programs, or restricting the number of program instances executed at the same time.

## Risk Assessment

| Finding                                           | Severity | Impact                              |
| ------------------------------------------------- | -------- | ----------------------------------- |
| CM-7(2) Prevent Program Execution not implemented | Medium   | Configuration Management            |
| CM-7(2) partially implemented                     | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-7(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-7.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-8, PL-4, PL-9, PM-5, PS-6) reviewed
