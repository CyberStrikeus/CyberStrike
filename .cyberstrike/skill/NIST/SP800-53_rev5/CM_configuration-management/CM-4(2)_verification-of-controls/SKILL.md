---
name: "CM-4(2)_verification-of-controls"
description: "After system changes, verify that the impacted controls are implemented correctly, operating as intended, and producing the desired outcome with regar"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-4-2
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
  - SA-11
  - SC-3
  - SI-6
prerequisites:
  - CM-4
severity_boost:
  SA-11: "Chain with SA-11 for comprehensive security coverage"
  SC-3: "Chain with SC-3 for comprehensive security coverage"
  SI-6: "Chain with SI-6 for comprehensive security coverage"
---

# CM-4(2) Verification of Controls

> **Enhancement of:** CM-4

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Implementation in this context refers to installing changed code in the operational system that may have an impact on security or privacy controls.

## What to Check

- [ ] Verify CM-4(2) Verification of Controls is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-4(2)
- [ ] Verify enhancement builds upon base control CM-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-4(2) implementation details. Verify the organization has documented how this control is satisfied.

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

After system changes, verify that the impacted controls are implemented correctly, operating as intended, and producing the desired outcome with regard to meeting the security and privacy requirements for the system.

### Implementation Guidance

Implementation in this context refers to installing changed code in the operational system that may have an impact on security or privacy controls.

## Risk Assessment

| Finding                                          | Severity | Impact                              |
| ------------------------------------------------ | -------- | ----------------------------------- |
| CM-4(2) Verification of Controls not implemented | Medium   | Configuration Management            |
| CM-4(2) partially implemented                    | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-4(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-4.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SA-11, SC-3, SI-6) reviewed
