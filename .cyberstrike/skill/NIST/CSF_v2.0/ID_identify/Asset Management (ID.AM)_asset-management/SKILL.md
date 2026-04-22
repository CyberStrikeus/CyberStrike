---
name: "Asset Management (ID.AM)_asset-management"
description: "Assets (e.g., data, hardware, software, systems, facilities, services, people) that enable the organization to achieve business purposes are identifie"
category: "information-gathering"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - asset management (id-am)
  - id
  - category
tech_stack:
  - aws
  - azure
  - gcp
  - network
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Asset Management (ID.AM) Asset Management

## High-Level Description

**Function:** IDENTIFY (ID)
**Framework:** NIST Cybersecurity Framework v2.0

Assets (e.g., data, hardware, software, systems, facilities, services, people) that enable the organization to achieve business purposes are identified and managed consistent with their relative importance to organizational objectives and the organization's risk strategy

## What to Check

- [ ] Verify Asset Management (ID.AM) Asset Management outcome is achieved
- [ ] Review documentation and evidence for Asset Management (ID.AM)
- [ ] Assess organizational maturity for IDENTIFY function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Asset Management (ID.AM).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Asset Management (ID.AM) outcome is met
# Interview stakeholders responsible for IDENTIFY
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools |
| Manual Review | Policy and procedure review | Interviews and documentation |

## Remediation Guide

Achieve the Asset Management (ID.AM) Asset Management outcome:

Assets (e.g., data, hardware, software, systems, facilities, services, people) that enable the organization to achieve business purposes are identified and managed consistent with their relative importance to organizational objectives and the organization's risk strategy

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Asset Management (ID.AM) Asset Management outcome not achieved | Medium | IDENTIFY Function Gap |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


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
