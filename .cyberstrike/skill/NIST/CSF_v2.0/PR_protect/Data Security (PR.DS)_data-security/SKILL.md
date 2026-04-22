---
name: "Data Security (PR.DS)_data-security"
description: "Data are managed consistent with the organization's risk strategy to protect the confidentiality, integrity, and availability of information"
category: "authorization"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - data security (pr-ds)
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

# Data Security (PR.DS) Data Security

## High-Level Description

**Function:** PROTECT (PR)
**Framework:** NIST Cybersecurity Framework v2.0

Data are managed consistent with the organization's risk strategy to protect the confidentiality, integrity, and availability of information

## What to Check

- [ ] Verify Data Security (PR.DS) Data Security outcome is achieved
- [ ] Review documentation and evidence for Data Security (PR.DS)
- [ ] Assess organizational maturity for PROTECT function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Data Security (PR.DS).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Data Security (PR.DS) outcome is met
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

Achieve the Data Security (PR.DS) Data Security outcome:

Data are managed consistent with the organization's risk strategy to protect the confidentiality, integrity, and availability of information

## Risk Assessment

| Finding                                                  | Severity | Impact               |
| -------------------------------------------------------- | -------- | -------------------- |
| Data Security (PR.DS) Data Security outcome not achieved | High     | PROTECT Function Gap |

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
