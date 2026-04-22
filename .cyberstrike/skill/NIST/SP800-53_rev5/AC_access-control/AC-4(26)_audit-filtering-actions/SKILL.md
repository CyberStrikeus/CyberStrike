---
name: "AC-4(26)_audit-filtering-actions"
description: "When transferring information between different security domains, record and audit content filtering actions and results for the information being fil"
category: "authorization"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ac-4-26
  - ac
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - AU-2
  - AU-3
  - AU-12
prerequisites:
  - AC-4
severity_boost:
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-3: "Chain with AU-3 for comprehensive security coverage"
  AU-12: "Chain with AU-12 for comprehensive security coverage"
---

# AC-4(26) Audit Filtering Actions

> **Enhancement of:** AC-4

## High-Level Description

**Family:** Access Control (AC)
**Framework:** NIST SP 800-53 Rev 5

Content filtering is the process of inspecting information as it traverses a cross-domain solution and determines if the information meets a predefined policy. Content filtering actions and the results of filtering actions are recorded for individual messages to ensure that the correct filter actions were applied. Content filter reports are used to assist in troubleshooting actions by, for example, determining why message content was modified and/or why it failed the filtering process. Audit events are defined in [AU-2](#au-2) . Audit records are generated in [AU-12](#au-12).

## What to Check

- [ ] Verify AC-4(26) Audit Filtering Actions is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AC-4(26)
- [ ] Verify enhancement builds upon base control AC-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AC-4(26) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                                | Usage                      |
| --------------- | -------------------------------------- | -------------------------- |
| cloud-audit-mcp | Check IAM policies and access controls | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test web application access controls   | `browser_auth_test`        |

## Remediation Guide

### Control Statement

When transferring information between different security domains, record and audit content filtering actions and results for the information being filtered.

### Implementation Guidance

Content filtering is the process of inspecting information as it traverses a cross-domain solution and determines if the information meets a predefined policy. Content filtering actions and the results of filtering actions are recorded for individual messages to ensure that the correct filter actions were applied. Content filter reports are used to assist in troubleshooting actions by, for example, determining why message content was modified and/or why it failed the filtering process. Audit events are defined in [AU-2](#au-2) . Audit records are generated in [AU-12](#au-12).

## Risk Assessment

| Finding                                          | Severity | Impact                    |
| ------------------------------------------------ | -------- | ------------------------- |
| AC-4(26) Audit Filtering Actions not implemented | High     | Access Control            |
| AC-4(26) partially implemented                   | Medium   | Incomplete Access Control |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [NIST SP 800-53 Rev 5 - AC-4(26)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ac-4.26)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-2, AU-3, AU-12) reviewed
