---
name: "PT-8_computer-matching-requirements"
description: "When a system or organization processes information for the purpose of conducting a matching program: Obtain approval from the Data Integrity Board to"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-8
  - pt
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - PM-24
prerequisites:
  []
severity_boost:
  PM-24: "Chain with PM-24 for comprehensive security coverage"
---

# PT-8 Computer Matching Requirements

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

The [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) establishes requirements for federal and non-federal agencies if they engage in a matching program. In general, a matching program is a computerized comparison of records from two or more automated [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) systems of records or an automated system of records and automated records maintained by a non-federal agency (or agent thereof). A matching program either pertains to federal benefit programs or federal personnel or payroll records. A federal benefit match is performed to determine or verify eligibility for payments under federal benefit programs or to recoup payments or delinquent debts under federal benefit programs. A matching program involves not just the matching activity itself but also the investigative follow-up and ultimate action, if any.

## What to Check

- [ ] Verify PT-8 Computer Matching Requirements is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-8 implementation details. Verify the organization has documented how this control is satisfied.

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

When a system or organization processes information for the purpose of conducting a matching program:
Obtain approval from the Data Integrity Board to conduct the matching program;
Develop and enter into a computer matching agreement;
Publish a matching notice in the Federal Register;
Independently verify the information produced by the matching program before taking adverse action against an individual, if required; and
Provide individuals with notice and an opportunity to contest the findings before taking adverse action against an individual.

### Implementation Guidance

The [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) establishes requirements for federal and non-federal agencies if they engage in a matching program. In general, a matching program is a computerized comparison of records from two or more automated [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) systems of records or an automated system of records and automated records maintained by a non-federal agency (or agent thereof). A matching program either pertains to federal benefit programs or federal personnel or payroll records. A federal benefit match is performed to determine or verify eligibility for payments under federal benefit programs or to recoup payments or delinquent debts under federal benefit programs. A matching program involves not just the matching activity itself but also the investigative follow-up and ultimate action, if any.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PT-8 Computer Matching Requirements not implemented | Medium | Personally Identifiable Information Processing and Transparency |
| PT-8 partially implemented | Low | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-359 | Exposure of Private Personal Information |


## References

- [NIST SP 800-53 Rev 5 - PT-8](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-8)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PM-24) reviewed
