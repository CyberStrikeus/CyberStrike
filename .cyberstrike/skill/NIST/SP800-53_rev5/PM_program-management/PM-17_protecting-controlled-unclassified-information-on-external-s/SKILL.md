---
name: "PM-17_protecting-controlled-unclassified-information-on-external-s"
description: "Establish policy and procedures to ensure that requirements for the protection of controlled unclassified information that is processed, stored or ..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-17
  - pm
tech_stack:
  - any
cwe_ids: []
chains_with:
  - CA-6
  - PM-10
prerequisites: []
severity_boost:
  CA-6: "Chain with CA-6 for comprehensive security coverage"
  PM-10: "Chain with PM-10 for comprehensive security coverage"
---

# PM-17 Protecting Controlled Unclassified Information on External Systems

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

Controlled unclassified information is defined by the National Archives and Records Administration along with the safeguarding and dissemination requirements for such information and is codified in [32 CFR 2002](#91f992fb-f668-4c91-a50f-0f05b95ccee3) and, specifically for systems external to the federal organization, [32 CFR 2002.14h](https://www.govinfo.gov/content/pkg/CFR-2017-title32-vol6/xml/CFR-2017-title32-vol6-part2002.xml) . The policy prescribes the specific use and conditions to be implemented in accordance with organizational procedures, including via its contracting processes.

## What to Check

- [ ] Verify PM-17 Protecting Controlled Unclassified Information on External Systems is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-17

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-17 implementation details. Verify the organization has documented how this control is satisfied.

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

Establish policy and procedures to ensure that requirements for the protection of controlled unclassified information that is processed, stored or transmitted on external systems, are implemented in accordance with applicable laws, executive orders, directives, policies, regulations, and standards; and
Review and update the policy and procedures [organization-defined].

### Implementation Guidance

Controlled unclassified information is defined by the National Archives and Records Administration along with the safeguarding and dissemination requirements for such information and is codified in [32 CFR 2002](#91f992fb-f668-4c91-a50f-0f05b95ccee3) and, specifically for systems external to the federal organization, [32 CFR 2002.14h](https://www.govinfo.gov/content/pkg/CFR-2017-title32-vol6/xml/CFR-2017-title32-vol6-part2002.xml) . The policy prescribes the specific use and conditions to be implemented in accordance with organizational procedures, including via its contracting processes.

## Risk Assessment

| Finding                                                                                  | Severity | Impact                        |
| ---------------------------------------------------------------------------------------- | -------- | ----------------------------- |
| PM-17 Protecting Controlled Unclassified Information on External Systems not implemented | Medium   | Program Management            |
| PM-17 partially implemented                                                              | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-17](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-17)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-6, PM-10) reviewed
