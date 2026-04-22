---
name: "Audit Record Reduction and Report Generation (03.03.06)_audit-record-reduction-and-report-generation"
description: "Implement an audit record reduction and report generation capability that supports audit record review, analysis, reporting requirements, and after..."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - audit record reduction and report generation (03-03-06)
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

# Audit Record Reduction and Report Generation (03.03.06) Audit Record Reduction and Report Generation

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Implement an audit record reduction and report generation capability that supports audit record review, analysis, reporting requirements, and after-the-fact investigations of incidents.
Preserve the original content and time ordering of audit records.

## What to Check

- [ ] Verify Audit Record Reduction and Report Generation (03.03.06) Audit Record Reduction and Report Generation is implemented for CUI systems
- [ ] Review SSP documentation for Audit Record Reduction and Report Generation (03.03.06)
- [ ] Validate CMMC Level 2 assessment objective for Audit Record Reduction and Report Generation (03.03.06)
- [ ] Confirm POA&M addresses any gaps for Audit Record Reduction and Report Generation (03.03.06)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Audit Record Reduction and Report Generation (03.03.06) implementation description and responsible parties.

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

Implement an audit record reduction and report generation capability that supports audit record review, analysis, reporting requirements, and after-the-fact investigations of incidents.
Preserve the original content and time ordering of audit records.

### Supplemental Guidance

Audit records are generated in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.03.03)03.03.03. Audit record reduction and report generation occur after audit record generation. Audit record reduction is a process that manipulates collected audit information and organizes it in a summary format that is more meaningful to analysts. Audit record reduction and report generation capabilities do not always come from the same system or organizational entities that conduct auditing activities. An audit record reduction capability can include, for example, modern data mining techniques with advanced data filters to identify anomalous behavior in audit records. The report generation capability provided by the system can help generate customizable reports. The time ordering of audit records can be a significant issue if the granularity of the time stamp in the record is insufficient.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Audit Record Reduction and Report Generation (03.03.06) Audit Record Reduction and Report Generation not implemented | Medium | CUI Protection - Audit and Accountability |
| Audit Record Reduction and Report Generation (03.03.06) partially implemented (POA&M) | Low | CMMC certification risk |

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

- [ ] SSP documents Audit Record Reduction and Report Generation (03.03.06) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
