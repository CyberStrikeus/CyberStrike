---
name: "AU-12(3)_changes-by-authorized-individuals"
description: "Provide and implement the capability for [organization-defined] to change the logging to be performed on [organization-defined] based on [organization"
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-12-3
  - au
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  - AC-3
prerequisites:
  - AU-12
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
---

# AU-12(3) Changes by Authorized Individuals

> **Enhancement of:** AU-12

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Permitting authorized individuals to make changes to system logging enables organizations to extend or limit logging as necessary to meet organizational requirements. Logging that is limited to conserve system resources may be extended (either temporarily or permanently) to address certain threat situations. In addition, logging may be limited to a specific set of event types to facilitate audit reduction, analysis, and reporting. Organizations can establish time thresholds in which logging actions are changed (e.g., near real-time, within minutes, or within hours).

## What to Check

- [ ] Verify AU-12(3) Changes by Authorized Individuals is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-12(3)
- [ ] Verify enhancement builds upon base control AU-12

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-12(3) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                      | Usage                            |
| --------------- | ---------------------------- | -------------------------------- |
| cloud-audit-mcp | Check logging configuration  | `cloud_audit_logging`            |
| AWS CLI         | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |

## Remediation Guide

### Control Statement

Provide and implement the capability for [organization-defined] to change the logging to be performed on [organization-defined] based on [organization-defined] within [organization-defined].

### Implementation Guidance

Permitting authorized individuals to make changes to system logging enables organizations to extend or limit logging as necessary to meet organizational requirements. Logging that is limited to conserve system resources may be extended (either temporarily or permanently) to address certain threat situations. In addition, logging may be limited to a specific set of event types to facilitate audit reduction, analysis, and reporting. Organizations can establish time thresholds in which logging actions are changed (e.g., near real-time, within minutes, or within hours).

## Risk Assessment

| Finding                                                    | Severity | Impact                              |
| ---------------------------------------------------------- | -------- | ----------------------------------- |
| AU-12(3) Changes by Authorized Individuals not implemented | Medium   | Audit and Accountability            |
| AU-12(3) partially implemented                             | Low      | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-53 Rev 5 - AU-12(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-12.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3) reviewed
