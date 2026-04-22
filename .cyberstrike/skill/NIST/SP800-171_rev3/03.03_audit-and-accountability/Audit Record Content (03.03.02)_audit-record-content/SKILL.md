---
name: "Audit Record Content (03.03.02)_audit-record-content"
description: "Include the following content in audit records: What type of event occurred When the event occurred Where the event occurred Source of the event Outco"
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - audit record content (03-03-02)
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

# Audit Record Content (03.03.02) Audit Record Content

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Include the following content in audit records:
What type of event occurred
When the event occurred
Where the event occurred
Source of the event
Outcome of the event
Identity of the individuals, subjects, objects, or entities associated with the event
Provide additional information for audit records as needed.

## What to Check

- [ ] Verify Audit Record Content (03.03.02) Audit Record Content is implemented for CUI systems
- [ ] Review SSP documentation for Audit Record Content (03.03.02)
- [ ] Validate CMMC Level 2 assessment objective for Audit Record Content (03.03.02)
- [ ] Confirm POA&M addresses any gaps for Audit Record Content (03.03.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Audit Record Content (03.03.02) implementation description and responsible parties.

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

Include the following content in audit records:
What type of event occurred
When the event occurred
Where the event occurred
Source of the event
Outcome of the event
Identity of the individuals, subjects, objects, or entities associated with the event
Provide additional information for audit records as needed.

### Supplemental Guidance

Audit record content that may be necessary to support the auditing function includes time stamps, source and destination addresses, user or process identifiers, event descriptions, file names, and the access control or flow control rules that are invoked. Event outcomes can include indicators of event success or failure and event-specific results (e.g., the security state of the system after the event occurred). Detailed information that organizations consider in audit records may include a full text recording of privileged commands or the individual identities of group account users.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Audit Record Content (03.03.02) Audit Record Content not implemented | Medium | CUI Protection - Audit and Accountability |
| Audit Record Content (03.03.02) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Audit Record Content (03.03.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
