---
name: "AT-3(5)_processing-personally-identifiable-information"
description: "Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of personally identifiable information"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-3-5
  - at
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - PT-2
  - PT-3
  - PT-5
  - PT-6
prerequisites:
  - AT-3
severity_boost:
  PT-2: "Chain with PT-2 for comprehensive security coverage"
  PT-3: "Chain with PT-3 for comprehensive security coverage"
  PT-5: "Chain with PT-5 for comprehensive security coverage"
---

# AT-3(5) Processing Personally Identifiable Information

> **Enhancement of:** AT-3

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Personally identifiable information processing and transparency controls include the organization’s authority to process personally identifiable information and personally identifiable information processing purposes. Role-based training for federal agencies addresses the types of information that may constitute personally identifiable information and the risks, considerations, and obligations associated with its processing. Such training also considers the authority to process personally identifiable information documented in privacy policies and notices, system of records notices, computer matching agreements and notices, privacy impact assessments, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements, contracts, information sharing agreements, memoranda of understanding, and/or other documentation.

## What to Check

- [ ] Verify AT-3(5) Processing Personally Identifiable Information is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-3(5)
- [ ] Verify enhancement builds upon base control AT-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-3(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide [organization-defined] with initial and [organization-defined] training in the employment and operation of personally identifiable information processing and transparency controls.

### Implementation Guidance

Personally identifiable information processing and transparency controls include the organization’s authority to process personally identifiable information and personally identifiable information processing purposes. Role-based training for federal agencies addresses the types of information that may constitute personally identifiable information and the risks, considerations, and obligations associated with its processing. Such training also considers the authority to process personally identifiable information documented in privacy policies and notices, system of records notices, computer matching agreements and notices, privacy impact assessments, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements, contracts, information sharing agreements, memoranda of understanding, and/or other documentation.

## Risk Assessment

| Finding                                                                | Severity | Impact                            |
| ---------------------------------------------------------------------- | -------- | --------------------------------- |
| AT-3(5) Processing Personally Identifiable Information not implemented | Medium   | Awareness and Training            |
| AT-3(5) partially implemented                                          | Low      | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-3(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-3.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PT-2, PT-3, PT-5, PT-6) reviewed
