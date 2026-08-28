---
name: "PT-4_consent"
description: "Implement [organization-defined] for individuals to consent to the processing of their personally identifiable information prior to its collection tha"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-4
  - pt
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - AC-16
  - PT-2
  - PT-5
prerequisites: []
severity_boost:
  AC-16: "Chain with AC-16 for comprehensive security coverage"
  PT-2: "Chain with PT-2 for comprehensive security coverage"
  PT-5: "Chain with PT-5 for comprehensive security coverage"
---

# PT-4 Consent

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

Consent allows individuals to participate in making decisions about the processing of their information and transfers some of the risk that arises from the processing of personally identifiable information from the organization to an individual. Consent may be required by applicable laws, executive orders, directives, regulations, policies, standards, or guidelines. Otherwise, when selecting consent as a control, organizations consider whether individuals can be reasonably expected to understand and accept the privacy risks that arise from their authorization. Organizations consider whether other controls may more effectively mitigate privacy risk either alone or in conjunction with consent. Organizations also consider any demographic or contextual factors that may influence the understanding or behavior of individuals with respect to the processing carried out by the system or organization. When soliciting consent from individuals, organizations consider the appropriate mechanism for obtaining consent, including the type of consent (e.g., opt-in, opt-out), how to properly authenticate and identity proof individuals and how to obtain consent through electronic means. In addition, organizations consider providing a mechanism for individuals to revoke consent once it has been provided, as appropriate. Finally, organizations consider usability factors to help individuals understand the risks being accepted when providing consent, including the use of plain language and avoiding technical jargon.

## What to Check

- [ ] Verify PT-4 Consent is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-4 implementation details. Verify the organization has documented how this control is satisfied.

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

Implement [organization-defined] for individuals to consent to the processing of their personally identifiable information prior to its collection that facilitate individuals’ informed decision-making.

### Implementation Guidance

Consent allows individuals to participate in making decisions about the processing of their information and transfers some of the risk that arises from the processing of personally identifiable information from the organization to an individual. Consent may be required by applicable laws, executive orders, directives, regulations, policies, standards, or guidelines. Otherwise, when selecting consent as a control, organizations consider whether individuals can be reasonably expected to understand and accept the privacy risks that arise from their authorization. Organizations consider whether other controls may more effectively mitigate privacy risk either alone or in conjunction with consent. Organizations also consider any demographic or contextual factors that may influence the understanding or behavior of individuals with respect to the processing carried out by the system or organization. When soliciting consent from individuals, organizations consider the appropriate mechanism for obtaining consent, including the type of consent (e.g., opt-in, opt-out), how to properly authenticate and identity proof individuals and how to obtain consent through electronic means. In addition, organizations consider providing a mechanism for individuals to revoke consent once it has been provided, as appropriate. Finally, organizations consider usability factors to help individuals understand the risks being accepted when providing consent, including the use of plain language and avoiding technical jargon.

## Risk Assessment

| Finding                      | Severity | Impact                                                                     |
| ---------------------------- | -------- | -------------------------------------------------------------------------- |
| PT-4 Consent not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-4 partially implemented   | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-4](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-16, PT-2, PT-5) reviewed
