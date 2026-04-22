---
name: "Event Logging (03.03.01)_event-logging"
description: "Specify the following event types selected for logging within the system: [organization-defined]."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - event logging (03-03-01)
  - family-03.03
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Event Logging (03.03.01) Event Logging

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Specify the following event types selected for logging within the system: [organization-defined].
Review and update the event types selected for logging [organization-defined].

## What to Check

- [ ] Verify Event Logging (03.03.01) Event Logging is implemented for CUI systems
- [ ] Review SSP documentation for Event Logging (03.03.01)
- [ ] Validate CMMC Level 2 assessment objective for Event Logging (03.03.01)
- [ ] Confirm POA&M addresses any gaps for Event Logging (03.03.01)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Event Logging (03.03.01) implementation description and responsible parties.

### Step 2: Assess Implementation

```
# Verify security controls protecting CUI
# Check access controls, encryption, monitoring as applicable

# For Linux systems:
ls -la /etc/security/ 2>/dev/null
grep -r "CUI\|controlled" /etc/security/ 2>/dev/null

# For cloud:
# Use cloud-audit-mcp tools to assess posture
```

### Step 3: CMMC Assessment Validation

Verify this requirement passes CMMC Level 2 assessment methodology per SP 800-171A Rev 3.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools |
| Manual Review | SSP and POA&M review | Documentation analysis |

## Remediation Guide

### Requirement Statement

Specify the following event types selected for logging within the system: [organization-defined].
Review and update the event types selected for logging [organization-defined].

### Supplemental Guidance

An event is any observable occurrence in a system, including unlawful or unauthorized system activity. Organizations identify event types for which a logging functionality is needed. This includes events that are relevant to the security of systems and the environments in which those systems operate to meet specific and ongoing auditing needs. Event types can include password changes, the execution of privileged functions, failed logons or accesses related to systems, administrative privilege usage, or third-party credential usage. In determining event types that require logging, organizations consider the system monitoring and auditing that are appropriate for each of the security requirements. When defining event types, organizations consider the logging necessary to cover related events, such as the steps in distributed, transaction-based processes (e.g., processes that are distributed across multiple organizations) and actions that occur in service-oriented or cloud-based architectures. Monitoring and auditing requirements can be balanced with other system needs. For example, organizations may determine that systems must have the capability to log every file access — both successful and unsuccessful — but only activate that capability under specific circumstances due to the potential burden on system performance. The event types that are logged by organizations may change over time. Reviewing and updating the set of logged event types are necessary to ensure that the current set of event types remains relevant.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Event Logging (03.03.01) Event Logging not implemented | Medium | CUI Protection - Audit and Accountability |
| Event Logging (03.03.01) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Event Logging (03.03.01) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
