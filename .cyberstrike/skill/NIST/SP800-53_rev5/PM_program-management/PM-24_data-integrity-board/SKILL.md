---
name: "PM-24_data-integrity-board"
description: "Establish a Data Integrity Board to: Review proposals to conduct or participate in a matching program; and Conduct an annual review of all matching pr"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-24
  - pm
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AC-4
  - PM-19
  - PM-23
  - PT-2
  - PT-8
prerequisites: []
severity_boost:
  AC-4: "Chain with AC-4 for comprehensive security coverage"
  PM-19: "Chain with PM-19 for comprehensive security coverage"
  PM-23: "Chain with PM-23 for comprehensive security coverage"
---

# PM-24 Data Integrity Board

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

A Data Integrity Board is the board of senior officials designated by the head of a federal agency and is responsible for, among other things, reviewing the agency’s proposals to conduct or participate in a matching program and conducting an annual review of all matching programs in which the agency has participated. As a general matter, a matching program is a computerized comparison of records from two or more automated [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) systems of records or an automated system of records and automated records maintained by a non-federal agency (or agent thereof). A matching program either pertains to Federal benefit programs or Federal personnel or payroll records. At a minimum, the Data Integrity Board includes the Inspector General of the agency, if any, and the senior agency official for privacy.

## What to Check

- [ ] Verify PM-24 Data Integrity Board is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-24

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-24 implementation details. Verify the organization has documented how this control is satisfied.

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

Establish a Data Integrity Board to:
Review proposals to conduct or participate in a matching program; and
Conduct an annual review of all matching programs in which the agency has participated.

### Implementation Guidance

A Data Integrity Board is the board of senior officials designated by the head of a federal agency and is responsible for, among other things, reviewing the agency’s proposals to conduct or participate in a matching program and conducting an annual review of all matching programs in which the agency has participated. As a general matter, a matching program is a computerized comparison of records from two or more automated [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) systems of records or an automated system of records and automated records maintained by a non-federal agency (or agent thereof). A matching program either pertains to Federal benefit programs or Federal personnel or payroll records. At a minimum, the Data Integrity Board includes the Inspector General of the agency, if any, and the senior agency official for privacy.

## Risk Assessment

| Finding                                    | Severity | Impact                        |
| ------------------------------------------ | -------- | ----------------------------- |
| PM-24 Data Integrity Board not implemented | Medium   | Program Management            |
| PM-24 partially implemented                | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-24](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-24)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-4, PM-19, PM-23, PT-2, PT-8) reviewed
