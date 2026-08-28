---
name: "PT-3(1)_data-tagging"
description: "Attach data tags containing the following purposes to [organization-defined]: [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-3-1
  - pt
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - CA-6
  - CM-12
  - PM-5
  - PM-22
  - SC-16
  - SC-43
  - SI-10
  - SI-15
  - SI-19
prerequisites:
  - PT-3
severity_boost:
  CA-6: "Chain with CA-6 for comprehensive security coverage"
  CM-12: "Chain with CM-12 for comprehensive security coverage"
  PM-5: "Chain with PM-5 for comprehensive security coverage"
---

# PT-3(1) Data Tagging

> **Enhancement of:** PT-3

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

Data tags support the tracking of processing purposes by conveying the purposes along with the relevant elements of personally identifiable information throughout the system. By conveying the processing purposes in a data tag along with the personally identifiable information as the information transits a system, a system owner or operator can identify whether a change in processing would be compatible with the identified and documented purposes. Data tags may also support the use of automated tools.

## What to Check

- [ ] Verify PT-3(1) Data Tagging is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-3(1)
- [ ] Verify enhancement builds upon base control PT-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-3(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Attach data tags containing the following purposes to [organization-defined]: [organization-defined].

### Implementation Guidance

Data tags support the tracking of processing purposes by conveying the purposes along with the relevant elements of personally identifiable information throughout the system. By conveying the processing purposes in a data tag along with the personally identifiable information as the information transits a system, a system owner or operator can identify whether a change in processing would be compatible with the identified and documented purposes. Data tags may also support the use of automated tools.

## Risk Assessment

| Finding                              | Severity | Impact                                                                     |
| ------------------------------------ | -------- | -------------------------------------------------------------------------- |
| PT-3(1) Data Tagging not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-3(1) partially implemented        | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-3(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-3.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-6, CM-12, PM-5, PM-22, SC-16) reviewed
