---
name: "AT-2(3)_social-engineering-and-mining"
description: "Provide literacy training on recognizing and reporting potential and actual instances of social engineering and social mining."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-2-3
  - at
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  - AT-2
severity_boost: {}
---

# AT-2(3) Social Engineering and Mining

> **Enhancement of:** AT-2

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Social engineering is an attempt to trick an individual into revealing information or taking an action that can be used to breach, compromise, or otherwise adversely impact a system. Social engineering includes phishing, pretexting, impersonation, baiting, quid pro quo, thread-jacking, social media exploitation, and tailgating. Social mining is an attempt to gather information about the organization that may be used to support future attacks. Literacy training includes information on how to communicate the concerns of employees and management regarding potential and actual instances of social engineering and data mining through organizational channels based on established policies and procedures.

## What to Check

- [ ] Verify AT-2(3) Social Engineering and Mining is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-2(3)
- [ ] Verify enhancement builds upon base control AT-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-2(3) implementation details. Verify the organization has documented how this control is satisfied.

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
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Provide literacy training on recognizing and reporting potential and actual instances of social engineering and social mining.

### Implementation Guidance

Social engineering is an attempt to trick an individual into revealing information or taking an action that can be used to breach, compromise, or otherwise adversely impact a system. Social engineering includes phishing, pretexting, impersonation, baiting, quid pro quo, thread-jacking, social media exploitation, and tailgating. Social mining is an attempt to gather information about the organization that may be used to support future attacks. Literacy training includes information on how to communicate the concerns of employees and management regarding potential and actual instances of social engineering and data mining through organizational channels based on established policies and procedures.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AT-2(3) Social Engineering and Mining not implemented | Medium | Awareness and Training |
| AT-2(3) partially implemented | Low | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-2(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-2.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
