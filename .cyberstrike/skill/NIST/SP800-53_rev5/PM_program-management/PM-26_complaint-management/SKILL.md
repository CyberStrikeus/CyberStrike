---
name: "PM-26_complaint-management"
description: "Implement a process for receiving and responding to complaints, concerns, or questions from individuals about the organizational security and privacy "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-26
  - pm
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - IR-7
  - IR-9
  - PM-22
  - SI-18
prerequisites:
  []
severity_boost:
  IR-7: "Chain with IR-7 for comprehensive security coverage"
  IR-9: "Chain with IR-9 for comprehensive security coverage"
  PM-22: "Chain with PM-22 for comprehensive security coverage"
---

# PM-26 Complaint Management

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

Complaints, concerns, and questions from individuals can serve as valuable sources of input to organizations and ultimately improve operational models, uses of technology, data collection practices, and controls. Mechanisms that can be used by the public include telephone hotline, email, or web-based forms. The information necessary for successfully filing complaints includes contact information for the senior agency official for privacy or other official designated to receive complaints. Privacy complaints may also include personally identifiable information which is handled in accordance with relevant policies and processes.

## What to Check

- [ ] Verify PM-26 Complaint Management is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-26

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-26 implementation details. Verify the organization has documented how this control is satisfied.

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

Implement a process for receiving and responding to complaints, concerns, or questions from individuals about the organizational security and privacy practices that includes:
Mechanisms that are easy to use and readily accessible by the public;
All information necessary for successfully filing complaints;
Tracking mechanisms to ensure all complaints received are reviewed and addressed within [organization-defined];
Acknowledgement of receipt of complaints, concerns, or questions from individuals within [organization-defined] ; and
Response to complaints, concerns, or questions from individuals within [organization-defined].

### Implementation Guidance

Complaints, concerns, and questions from individuals can serve as valuable sources of input to organizations and ultimately improve operational models, uses of technology, data collection practices, and controls. Mechanisms that can be used by the public include telephone hotline, email, or web-based forms. The information necessary for successfully filing complaints includes contact information for the senior agency official for privacy or other official designated to receive complaints. Privacy complaints may also include personally identifiable information which is handled in accordance with relevant policies and processes.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PM-26 Complaint Management not implemented | Medium | Program Management |
| PM-26 partially implemented | Low | Incomplete Program Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-26](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-26)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IR-7, IR-9, PM-22, SI-18) reviewed
