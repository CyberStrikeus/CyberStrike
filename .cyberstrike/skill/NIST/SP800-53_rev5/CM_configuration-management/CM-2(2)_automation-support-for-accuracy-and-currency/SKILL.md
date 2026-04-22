---
name: "CM-2(2)_automation-support-for-accuracy-and-currency"
description: "Maintain the currency, completeness, accuracy, and availability of the baseline configuration of the system using [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-2-2
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
  - CM-7
  - IA-3
  - RA-5
prerequisites:
  - CM-2
severity_boost:
  CM-7: "Chain with CM-7 for comprehensive security coverage"
  IA-3: "Chain with IA-3 for comprehensive security coverage"
  RA-5: "Chain with RA-5 for comprehensive security coverage"
---

# CM-2(2) Automation Support for Accuracy and Currency

> **Enhancement of:** CM-2

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Automated mechanisms that help organizations maintain consistent baseline configurations for systems include configuration management tools, hardware, software, firmware inventory tools, and network management tools. Automated tools can be used at the organization level, mission and business process level, or system level on workstations, servers, notebook computers, network components, or mobile devices. Tools can be used to track version numbers on operating systems, applications, types of software installed, and current patch levels. Automation support for accuracy and currency can be satisfied by the implementation of [CM-8(2)](#cm-8.2) for organizations that combine system component inventory and baseline configuration activities.

## What to Check

- [ ] Verify CM-2(2) Automation Support for Accuracy and Currency is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-2(2)
- [ ] Verify enhancement builds upon base control CM-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-2(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Maintain the currency, completeness, accuracy, and availability of the baseline configuration of the system using [organization-defined].

### Implementation Guidance

Automated mechanisms that help organizations maintain consistent baseline configurations for systems include configuration management tools, hardware, software, firmware inventory tools, and network management tools. Automated tools can be used at the organization level, mission and business process level, or system level on workstations, servers, notebook computers, network components, or mobile devices. Tools can be used to track version numbers on operating systems, applications, types of software installed, and current patch levels. Automation support for accuracy and currency can be satisfied by the implementation of [CM-8(2)](#cm-8.2) for organizations that combine system component inventory and baseline configuration activities.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-2(2) Automation Support for Accuracy and Currency not implemented | Medium | Configuration Management |
| CM-2(2) partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-2(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-2.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-7, IA-3, RA-5) reviewed
