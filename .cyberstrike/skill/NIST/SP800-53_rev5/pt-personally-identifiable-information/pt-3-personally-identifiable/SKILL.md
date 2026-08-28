---
name: "PT-3_personally-identifiable-information-processing-purposes"
description: "Identify and document the [organization-defined] for processing personally identifiable information;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-3
  - pt
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - AC-2
  - AC-3
  - AT-3
  - CM-13
  - IR-9
  - PM-9
  - PM-25
  - PT-2
  - PT-5
  - PT-6
prerequisites: []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AT-3: "Chain with AT-3 for comprehensive security coverage"
---

# PT-3 Personally Identifiable Information Processing Purposes

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

Identifying and documenting the purpose for processing provides organizations with a basis for understanding why personally identifiable information may be processed. The term "process" includes every step of the information life cycle, including creation, collection, use, processing, storage, maintenance, dissemination, disclosure, and disposal. Identifying and documenting the purpose of processing is a prerequisite to enabling owners and operators of the system and individuals whose information is processed by the system to understand how the information will be processed. This enables individuals to make informed decisions about their engagement with information systems and organizations and to manage their privacy interests. Once the specific processing purpose has been identified, the purpose is described in the organization’s privacy notices, policies, and any related privacy compliance documentation, including privacy impact assessments, system of records notices, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements, computer matching notices, and other applicable Federal Register notices.

Organizations take steps to help ensure that personally identifiable information is processed only for identified purposes, including training organizational personnel and monitoring and auditing organizational processing of personally identifiable information.

Organizations monitor for changes in personally identifiable information processing. Organizational personnel consult with the senior agency official for privacy and legal counsel to ensure that any new purposes that arise from changes in processing are compatible with the purpose for which the information was collected, or if the new purpose is not compatible, implement mechanisms in accordance with defined requirements to allow for the new processing, if appropriate. Mechanisms may include obtaining consent from individuals, revising privacy policies, or other measures to manage privacy risks that arise from changes in personally identifiable information processing purposes.

## What to Check

- [ ] Verify PT-3 Personally Identifiable Information Processing Purposes is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-3 implementation details. Verify the organization has documented how this control is satisfied.

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

Identify and document the [organization-defined] for processing personally identifiable information;
Describe the purpose(s) in the public privacy notices and policies of the organization;
Restrict the [organization-defined] of personally identifiable information to only that which is compatible with the identified purpose(s); and
Monitor changes in processing personally identifiable information and implement [organization-defined] to ensure that any changes are made in accordance with [organization-defined].

### Implementation Guidance

Identifying and documenting the purpose for processing provides organizations with a basis for understanding why personally identifiable information may be processed. The term "process" includes every step of the information life cycle, including creation, collection, use, processing, storage, maintenance, dissemination, disclosure, and disposal. Identifying and documenting the purpose of processing is a prerequisite to enabling owners and operators of the system and individuals whose information is processed by the system to understand how the information will be processed. This enables individuals to make informed decisions about their engagement with information systems and organizations and to manage their privacy interests. Once the specific processing purpose has been identified, the purpose is described in the organization’s privacy notices, policies, and any related privacy compliance documentation, including privacy impact assessments, system of records notices, [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) statements, computer matching notices, and other applicable Federal Register notices.

Organizations take steps to help ensure that personally identifiable information is processed only for identified purposes, including training organizational personnel and monitoring and auditing organizational processing of personally identifiable information.

Organizations monitor for changes in personally identifiable information processing. Organizational personnel consult with the senior agency official for privacy and legal counsel to ensure that any new purposes that arise from changes in processing are compatible with the purpose for which the information was collected, or if the new purpose is not compatible, implement mechanisms in accordance with defined requirements to allow for the new processing, if appropriate. Mechanisms may include obtaining consent from individuals, revising privacy policies, or other measures to manage privacy risks that arise from changes in personally identifiable information processing purposes.

## Risk Assessment

| Finding                                                                      | Severity | Impact                                                                     |
| ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| PT-3 Personally Identifiable Information Processing Purposes not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-3 partially implemented                                                   | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-3](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-3, AT-3, CM-13, IR-9) reviewed
