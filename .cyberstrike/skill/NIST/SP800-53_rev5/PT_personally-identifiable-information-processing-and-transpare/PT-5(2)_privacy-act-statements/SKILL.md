---
name: "PT-5(2)_privacy-act-statements"
description: "Include Privacy Act statements on forms that collect information that will be maintained in a Privacy Act system of records, or provide Privacy Act st"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-5-2
  - pt
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - PT-6
prerequisites:
  - PT-5
severity_boost:
  PT-6: "Chain with PT-6 for comprehensive security coverage"
---

# PT-5(2) Privacy Act Statements

> **Enhancement of:** PT-5

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

If a federal agency asks individuals to supply information that will become part of a system of records, the agency is required to provide a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statement on the form used to collect the information or on a separate form that can be retained by the individual. The agency provides a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statement in such circumstances regardless of whether the information will be collected on a paper or electronic form, on a website, on a mobile application, over the telephone, or through some other medium. This requirement ensures that the individual is provided with sufficient information about the request for information to make an informed decision on whether or not to respond.

[PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements provide formal notice to individuals of the authority that authorizes the solicitation of the information; whether providing the information is mandatory or voluntary; the principal purpose(s) for which the information is to be used; the published routine uses to which the information is subject; the effects on the individual, if any, of not providing all or any part of the information requested; and an appropriate citation and link to the relevant system of records notice. Federal agency personnel consult with the senior agency official for privacy and legal counsel regarding the notice provisions of the [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455).

## What to Check

- [ ] Verify PT-5(2) Privacy Act Statements is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-5(2)
- [ ] Verify enhancement builds upon base control PT-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-5(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Include Privacy Act statements on forms that collect information that will be maintained in a Privacy Act system of records, or provide Privacy Act statements on separate forms that can be retained by individuals.

### Implementation Guidance

If a federal agency asks individuals to supply information that will become part of a system of records, the agency is required to provide a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statement on the form used to collect the information or on a separate form that can be retained by the individual. The agency provides a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statement in such circumstances regardless of whether the information will be collected on a paper or electronic form, on a website, on a mobile application, over the telephone, or through some other medium. This requirement ensures that the individual is provided with sufficient information about the request for information to make an informed decision on whether or not to respond.

[PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements provide formal notice to individuals of the authority that authorizes the solicitation of the information; whether providing the information is mandatory or voluntary; the principal purpose(s) for which the information is to be used; the published routine uses to which the information is subject; the effects on the individual, if any, of not providing all or any part of the information requested; and an appropriate citation and link to the relevant system of records notice. Federal agency personnel consult with the senior agency official for privacy and legal counsel regarding the notice provisions of the [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455).

## Risk Assessment

| Finding                                        | Severity | Impact                                                                     |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| PT-5(2) Privacy Act Statements not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-5(2) partially implemented                  | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-5(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-5.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PT-6) reviewed
