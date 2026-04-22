---
name: "Response to Audit Logging Process Failures (03.03.04)_response-to-audit-logging-process-failures"
description: "Alert organizational personnel or roles within [organization-defined] in the event of an audit logging process failure."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - response to audit logging process failures (03-03-04)
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

# Response to Audit Logging Process Failures (03.03.04) Response to Audit Logging Process Failures

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Alert organizational personnel or roles within [organization-defined] in the event of an audit logging process failure.
Take the following additional actions: [organization-defined].

## What to Check

- [ ] Verify Response to Audit Logging Process Failures (03.03.04) Response to Audit Logging Process Failures is implemented for CUI systems
- [ ] Review SSP documentation for Response to Audit Logging Process Failures (03.03.04)
- [ ] Validate CMMC Level 2 assessment objective for Response to Audit Logging Process Failures (03.03.04)
- [ ] Confirm POA&M addresses any gaps for Response to Audit Logging Process Failures (03.03.04)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Response to Audit Logging Process Failures (03.03.04) implementation description and responsible parties.

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

Alert organizational personnel or roles within [organization-defined] in the event of an audit logging process failure.
Take the following additional actions: [organization-defined].

### Supplemental Guidance

Audit logging process failures include software and hardware errors, failures in audit log capturing mechanisms, and reaching or exceeding audit log storage capacity. Response actions include overwriting the oldest audit records, shutting down the system, and stopping the generation of audit records. Organizations may choose to define additional actions for audit logging process failures based on the type of failure, the location of the failure, the severity of the failure, or a combination of such factors. When the audit logging process failure is related to storage, the response is carried out for the audit log storage repository (i.e., the distinct system component where the audit logs are stored), the system on which the audit logs reside, the total audit log storage capacity of the organization (i.e., all audit log storage repositories combined), or all three. Organizations may decide to take no additional actions after alerting designated roles or personnel.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Response to Audit Logging Process Failures (03.03.04) Response to Audit Logging Process Failures not implemented | Medium | CUI Protection - Audit and Accountability |
| Response to Audit Logging Process Failures (03.03.04) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Response to Audit Logging Process Failures (03.03.04) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
