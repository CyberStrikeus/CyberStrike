---
name: "Continuous Monitoring (DE.CM)_continuous-monitoring"
description: "Assets are monitored to find anomalies, indicators of compromise, and other potentially adverse events"
category: "information-gathering"
version: "2.0"
author: "cyberstrike-official"
tags:
  - nist
  - csf
  - v2.0
  - continuous monitoring (de-cm)
  - de
  - category
tech_stack:
  - aws
  - azure
  - gcp
  - siem
cwe_ids:
  - CWE-778
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Continuous Monitoring (DE.CM) Continuous Monitoring

## High-Level Description

**Function:** DETECT (DE)
**Framework:** NIST Cybersecurity Framework v2.0

Assets are monitored to find anomalies, indicators of compromise, and other potentially adverse events

## What to Check

- [ ] Verify Continuous Monitoring (DE.CM) Continuous Monitoring outcome is achieved
- [ ] Review documentation and evidence for Continuous Monitoring (DE.CM)
- [ ] Assess organizational maturity for DETECT function

## How to Test

### Step 1: Identify Current Profile

Determine the organization's current and target CSF profile tier for Continuous Monitoring (DE.CM).

### Step 2: Assess Outcome Achievement

```
# Review organizational policies and procedures
# Check for evidence that Continuous Monitoring (DE.CM) outcome is met
# Interview stakeholders responsible for DETECT
```

### Step 3: Map to Technical Controls

Identify which SP 800-53 controls implement this CSF outcome and verify their operating effectiveness.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud security posture | `cloud_audit_*` tools |
| Manual Review | Policy and procedure review | Interviews and documentation |

## Remediation Guide

Achieve the Continuous Monitoring (DE.CM) Continuous Monitoring outcome:

Assets are monitored to find anomalies, indicators of compromise, and other potentially adverse events

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Continuous Monitoring (DE.CM) Continuous Monitoring outcome not achieved | High | DETECT Function Gap |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


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
