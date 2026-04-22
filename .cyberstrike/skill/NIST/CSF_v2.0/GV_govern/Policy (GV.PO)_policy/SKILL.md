---
name: "Policy (GV.PO)_policy"
description: "Organizational cybersecurity policy is established, communicated, and enforced"
category: "configuration"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - policy (gv-po)
  - gv
  - category
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Policy (GV.PO) Policy

## High-Level Description

**Function:** GOVERN (GV)
**Framework:** NIST Cybersecurity Framework v2.0

Organizational cybersecurity policy is established, communicated, and enforced

## What to Check

- [ ] Verify Policy (GV.PO) Policy outcome is achieved
- [ ] Review documentation and evidence for Policy (GV.PO)
- [ ] Assess organizational maturity for GOVERN function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Policy (GV.PO).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Policy (GV.PO) outcome is met
# Interview stakeholders responsible for GOVERN
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool            | Purpose                       | Usage                        |
| --------------- | ----------------------------- | ---------------------------- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools        |
| Manual Review   | Policy and procedure review   | Interviews and documentation |

## Remediation Guide

Achieve the Policy (GV.PO) Policy outcome:

Organizational cybersecurity policy is established, communicated, and enforced

## Risk Assessment

| Finding                                    | Severity | Impact              |
| ------------------------------------------ | -------- | ------------------- |
| Policy (GV.PO) Policy outcome not achieved | Medium   | GOVERN Function Gap |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

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
