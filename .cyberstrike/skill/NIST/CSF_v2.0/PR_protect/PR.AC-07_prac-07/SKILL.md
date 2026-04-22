---
name: "PR.AC-07_prac-07"
description: "Users, devices, and other assets are authenticated (e.g., single-factor, multi-factor) commensurate with the risk of the transaction (e.g., individual"
category: "authorization"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - pr-ac-07
  - pr
  - subcategory
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  - Identity Management, Authentication and Access Control (PR.AC)
severity_boost: {}
---

# PR.AC-07 PR.AC-07

> **Subcategory of:** Identity Management, Authentication and Access Control (PR.AC)

## High-Level Description

**Function:** PROTECT (PR)
**Framework:** NIST Cybersecurity Framework v2.0

Users, devices, and other assets are authenticated (e.g., single-factor, multi-factor) commensurate with the risk of the transaction (e.g., individuals’ security and privacy risks and other organizational risks)

## What to Check

- [ ] Verify PR.AC-07 PR.AC-07 outcome is achieved
- [ ] Review documentation and evidence for PR.AC-07
- [ ] Assess organizational maturity for PROTECT function
- [ ] Map to SP 800-53 controls that satisfy PR.AC-07

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for PR.AC-07.

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that PR.AC-07 outcome is met
# Interview stakeholders responsible for PROTECT
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools |
| Manual Review | Policy and procedure review | Interviews and documentation |

## Remediation Guide

Achieve the PR.AC-07 PR.AC-07 outcome:

Users, devices, and other assets are authenticated (e.g., single-factor, multi-factor) commensurate with the risk of the transaction (e.g., individuals’ security and privacy risks and other organizational risks)

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PR.AC-07 PR.AC-07 outcome not achieved | High | PROTECT Function Gap |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [NIST CSF v2.0](https://www.nist.gov/cyberframework)
- [NIST CSF v2.0 Reference Tool](https://csrc.nist.gov/projects/cybersecurity-framework/filters#/csf/filters)
- [CSF 2.0 Quick Start Guides](https://www.nist.gov/cyberframework/getting-started)

## Checklist

- [ ] Current profile tier assessed
- [ ] Target profile tier defined
- [ ] Gap analysis completed
- [ ] SP 800-53 control mapping verified
- [ ] Implementation roadmap exists
