---
name: "Awareness and Training (PR.AT)_awareness-and-training"
description: "The organization's personnel are provided with cybersecurity awareness and training so that they can perform their cybersecurity-related tasks"
category: "authorization"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - awareness and training (pr-at)
  - pr
  - category
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# Awareness and Training (PR.AT) Awareness and Training

## High-Level Description

**Function:** PROTECT (PR)
**Framework:** NIST Cybersecurity Framework v2.0

The organization's personnel are provided with cybersecurity awareness and training so that they can perform their cybersecurity-related tasks

## What to Check

- [ ] Verify Awareness and Training (PR.AT) Awareness and Training outcome is achieved
- [ ] Review documentation and evidence for Awareness and Training (PR.AT)
- [ ] Assess organizational maturity for PROTECT function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Awareness and Training (PR.AT).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Awareness and Training (PR.AT) outcome is met
# Interview stakeholders responsible for PROTECT
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool            | Purpose                       | Usage                        |
| --------------- | ----------------------------- | ---------------------------- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools        |
| Manual Review   | Policy and procedure review   | Interviews and documentation |

## Remediation Guide

Achieve the Awareness and Training (PR.AT) Awareness and Training outcome:

The organization's personnel are provided with cybersecurity awareness and training so that they can perform their cybersecurity-related tasks

## Risk Assessment

| Finding                                                                    | Severity | Impact               |
| -------------------------------------------------------------------------- | -------- | -------------------- |
| Awareness and Training (PR.AT) Awareness and Training outcome not achieved | High     | PROTECT Function Gap |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
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
