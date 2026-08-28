---
name: "Audit Record Generation (03.03.03)_audit-record-generation"
description: "Generate audit records for the selected event types and audit record content specified in 03.03.01 and 03.03.02."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - audit record generation (03-03-03)
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
chains_with: []
prerequisites: []
severity_boost: {}
---

# Audit Record Generation (03.03.03) Audit Record Generation

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Generate audit records for the selected event types and audit record content specified in 03.03.01 and 03.03.02.
Retain audit records for a time period consistent with the records retention policy.

## What to Check

- [ ] Verify Audit Record Generation (03.03.03) Audit Record Generation is implemented for CUI systems
- [ ] Review SSP documentation for Audit Record Generation (03.03.03)
- [ ] Validate CMMC Level 2 assessment objective for Audit Record Generation (03.03.03)
- [ ] Confirm POA&M addresses any gaps for Audit Record Generation (03.03.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Audit Record Generation (03.03.03) implementation description and responsible parties.

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

| Tool            | Purpose                      | Usage                  |
| --------------- | ---------------------------- | ---------------------- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools  |
| Manual Review   | SSP and POA&M review         | Documentation analysis |

## Remediation Guide

### Requirement Statement

Generate audit records for the selected event types and audit record content specified in 03.03.01 and 03.03.02.
Retain audit records for a time period consistent with the records retention policy.

### Supplemental Guidance

Audit records can be generated at various levels of abstraction, including at the packet level as information traverses the network. Selecting the appropriate level of abstraction is a critical aspect of an audit logging capability and can facilitate the identification of root causes to problems. The ability to add information generated in audit records is dependent on system functionality to configure the audit record content. Organizations may consider additional information in audit records, including the access control or flow control rules invoked and the individual identities of group account users. Organizations may also consider limiting additional audit record information to only information that is explicitly needed for audit requirements.

## Risk Assessment

| Finding                                                                    | Severity | Impact                                    |
| -------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| Audit Record Generation (03.03.03) Audit Record Generation not implemented | Medium   | CUI Protection - Audit and Accountability |
| Audit Record Generation (03.03.03) partially implemented (POA&M)           | Low      | CMMC certification risk                   |

## CWE Categories

| CWE ID  | Title                |
| ------- | -------------------- |
| CWE-778 | Insufficient Logging |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Audit Record Generation (03.03.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
