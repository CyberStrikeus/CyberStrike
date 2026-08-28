---
name: "PT-5(1)_just-in-time-notice"
description: "Present notice of personally identifiable information processing to individuals at a time and location where the individual provides personally identi"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-5-1
  - pt
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - PM-21
prerequisites:
  - PT-5
severity_boost:
  PM-21: "Chain with PM-21 for comprehensive security coverage"
---

# PT-5(1) Just-in-time Notice

> **Enhancement of:** PT-5

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

Just-in-time notices inform individuals of how organizations process their personally identifiable information at a time when such notices may be most useful to the individuals. Individual assumptions about how personally identifiable information will be processed might not be accurate or reliable if time has passed since the organization last presented notice or the circumstances under which the individual was last provided notice have changed. A just-in-time notice can explain data actions that organizations have identified as potentially giving rise to greater privacy risk for individuals. Organizations can use a just-in-time notice to update or remind individuals about specific data actions as they occur or highlight specific changes that occurred since last presenting notice. A just-in-time notice can be used in conjunction with just-in-time consent to explain what will occur if consent is declined. Organizations use discretion to determine when to use a just-in-time notice and may use supporting information on user demographics, focus groups, or surveys to learn about users’ privacy interests and concerns.

## What to Check

- [ ] Verify PT-5(1) Just-in-time Notice is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-5(1)
- [ ] Verify enhancement builds upon base control PT-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-5(1) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool          | Purpose                           | Usage |
| ------------- | --------------------------------- | ----- |
| Manual Review | Documentation and interview-based | N/A   |

## Remediation Guide

### Control Statement

Present notice of personally identifiable information processing to individuals at a time and location where the individual provides personally identifiable information or in conjunction with a data action, or [organization-defined].

### Implementation Guidance

Just-in-time notices inform individuals of how organizations process their personally identifiable information at a time when such notices may be most useful to the individuals. Individual assumptions about how personally identifiable information will be processed might not be accurate or reliable if time has passed since the organization last presented notice or the circumstances under which the individual was last provided notice have changed. A just-in-time notice can explain data actions that organizations have identified as potentially giving rise to greater privacy risk for individuals. Organizations can use a just-in-time notice to update or remind individuals about specific data actions as they occur or highlight specific changes that occurred since last presenting notice. A just-in-time notice can be used in conjunction with just-in-time consent to explain what will occur if consent is declined. Organizations use discretion to determine when to use a just-in-time notice and may use supporting information on user demographics, focus groups, or surveys to learn about users’ privacy interests and concerns.

## Risk Assessment

| Finding                                     | Severity | Impact                                                                     |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| PT-5(1) Just-in-time Notice not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-5(1) partially implemented               | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-5(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-5.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PM-21) reviewed
