---
name: "Platform Security (PR.PS)_platform-security"
description: "The hardware, software (e.g., firmware, operating systems, applications), and services of physical and virtual platforms are managed consistent with t"
category: "authorization"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - platform security (pr-ps)
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

# Platform Security (PR.PS) Platform Security

## High-Level Description

**Function:** PROTECT (PR)
**Framework:** NIST Cybersecurity Framework v2.0

The hardware, software (e.g., firmware, operating systems, applications), and services of physical and virtual platforms are managed consistent with the organization's risk strategy to protect their confidentiality, integrity, and availability

## What to Check

- [ ] Verify Platform Security (PR.PS) Platform Security outcome is achieved
- [ ] Review documentation and evidence for Platform Security (PR.PS)
- [ ] Assess organizational maturity for PROTECT function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Platform Security (PR.PS).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Platform Security (PR.PS) outcome is met
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

Achieve the Platform Security (PR.PS) Platform Security outcome:

The hardware, software (e.g., firmware, operating systems, applications), and services of physical and virtual platforms are managed consistent with the organization's risk strategy to protect their confidentiality, integrity, and availability

## Risk Assessment

| Finding                                                          | Severity | Impact               |
| ---------------------------------------------------------------- | -------- | -------------------- |
| Platform Security (PR.PS) Platform Security outcome not achieved | High     | PROTECT Function Gap |

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
