---
name: "CM-7(8)_binary-or-machine-executable-code"
description: "Prohibit the use of binary or machine-executable code from sources with limited or no warranty or without the provision of source code;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-7-8
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
  - SA-5
  - SA-22
prerequisites:
  - CM-7
severity_boost:
  SA-5: "Chain with SA-5 for comprehensive security coverage"
  SA-22: "Chain with SA-22 for comprehensive security coverage"
---

# CM-7(8) Binary or Machine Executable Code

> **Enhancement of:** CM-7

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Binary or machine executable code applies to all sources of binary or machine-executable code, including commercial software and firmware and open-source software. Organizations assess software products without accompanying source code or from sources with limited or no warranty for potential security impacts. The assessments address the fact that software products without the provision of source code may be difficult to review, repair, or extend. In addition, there may be no owners to make such repairs on behalf of organizations. If open-source software is used, the assessments address the fact that there is no warranty, the open-source software could contain back doors or malware, and there may be no support available.

## What to Check

- [ ] Verify CM-7(8) Binary or Machine Executable Code is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-7(8)
- [ ] Verify enhancement builds upon base control CM-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-7(8) implementation details. Verify the organization has documented how this control is satisfied.

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

Prohibit the use of binary or machine-executable code from sources with limited or no warranty or without the provision of source code; and
Allow exceptions only for compelling mission or operational requirements and with the approval of the authorizing official.

### Implementation Guidance

Binary or machine executable code applies to all sources of binary or machine-executable code, including commercial software and firmware and open-source software. Organizations assess software products without accompanying source code or from sources with limited or no warranty for potential security impacts. The assessments address the fact that software products without the provision of source code may be difficult to review, repair, or extend. In addition, there may be no owners to make such repairs on behalf of organizations. If open-source software is used, the assessments address the fact that there is no warranty, the open-source software could contain back doors or malware, and there may be no support available.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CM-7(8) Binary or Machine Executable Code not implemented | Medium | Configuration Management |
| CM-7(8) partially implemented | Low | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - CM-7(8)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-7.8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SA-5, SA-22) reviewed
