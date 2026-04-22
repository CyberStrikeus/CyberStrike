---
name: "PM-20_dissemination-of-privacy-program-information"
description: "Maintain a central resource webpage on the organization’s principal public website that serves as a central source of information about the organizati"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-20
  - pm
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AC-3
  - PM-19
  - PT-5
  - PT-6
  - PT-7
  - RA-8
prerequisites:
  []
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  PM-19: "Chain with PM-19 for comprehensive security coverage"
  PT-5: "Chain with PT-5 for comprehensive security coverage"
---

# PM-20 Dissemination of Privacy Program Information

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

For federal agencies, the webpage is located at www.[agency].gov/privacy. Federal agencies include public privacy impact assessments, system of records notices, computer matching notices and agreements, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) exemption and implementation rules, privacy reports, privacy policies, instructions for individuals making an access or amendment request, email addresses for questions/complaints, blogs, and periodic publications.

## What to Check

- [ ] Verify PM-20 Dissemination of Privacy Program Information is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-20

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-20 implementation details. Verify the organization has documented how this control is satisfied.

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

Maintain a central resource webpage on the organization’s principal public website that serves as a central source of information about the organization’s privacy program and that:
Ensures that the public has access to information about organizational privacy activities and can communicate with its senior agency official for privacy;
Ensures that organizational privacy practices and reports are publicly available; and
Employs publicly facing email addresses and/or phone lines to enable the public to provide feedback and/or direct questions to privacy offices regarding privacy practices.

### Implementation Guidance

For federal agencies, the webpage is located at www.[agency].gov/privacy. Federal agencies include public privacy impact assessments, system of records notices, computer matching notices and agreements, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) exemption and implementation rules, privacy reports, privacy policies, instructions for individuals making an access or amendment request, email addresses for questions/complaints, blogs, and periodic publications.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PM-20 Dissemination of Privacy Program Information not implemented | Medium | Program Management |
| PM-20 partially implemented | Low | Incomplete Program Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-20](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-20)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, PM-19, PT-5, PT-6, PT-7) reviewed
