---
name: "Audit Record Review, Analysis, and Reporting (03.03.05)_audit-record-review-analysis-and-reporting"
description: "Review and analyze system audit records [organization-defined] for indications and the potential impact of inappropriate or unusual activity."
category: "information-gathering"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - audit record review, analysis, and reporting (03-03-05)
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

# Audit Record Review, Analysis, and Reporting (03.03.05) Audit Record Review, Analysis, and Reporting

## High-Level Description

**Family:** Audit and Accountability
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Review and analyze system audit records [organization-defined] for indications and the potential impact of inappropriate or unusual activity.
Report findings to organizational personnel or roles.
Analyze and correlate audit records across different repositories to gain organization-wide situational awareness.

## What to Check

- [ ] Verify Audit Record Review, Analysis, and Reporting (03.03.05) Audit Record Review, Analysis, and Reporting is implemented for CUI systems
- [ ] Review SSP documentation for Audit Record Review, Analysis, and Reporting (03.03.05)
- [ ] Validate CMMC Level 2 assessment objective for Audit Record Review, Analysis, and Reporting (03.03.05)
- [ ] Confirm POA&M addresses any gaps for Audit Record Review, Analysis, and Reporting (03.03.05)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Audit Record Review, Analysis, and Reporting (03.03.05) implementation description and responsible parties.

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

Review and analyze system audit records [organization-defined] for indications and the potential impact of inappropriate or unusual activity.
Report findings to organizational personnel or roles.
Analyze and correlate audit records across different repositories to gain organization-wide situational awareness.

### Supplemental Guidance

Audit record review, analysis, and reporting cover information security logging performed by organizations and can include logging that results from the monitoring of account usage, remote access, wireless connectivity, configuration settings, the use of maintenance tools and nonlocal maintenance, system component inventory, mobile device connection, equipment delivery and removal, physical access, temperature and humidity, communications at system interfaces, and the use of mobile code. Findings can be reported to organizational entities, such as the incident response team, help desk, and security or privacy offices. If organizations are prohibited from reviewing and analyzing audit records or unable to conduct such activities, the review or analysis may be carried out by other organizations granted such authority. The scope, frequency, and/or depth of the audit record review, analysis, and reporting may be adjusted to meet organizational needs based on new information received. Correlating audit record review, analysis, and reporting processes helps to ensure that audit records collectively create a more complete view of events.

## Risk Assessment

| Finding                                                                                                              | Severity | Impact                                    |
| -------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| Audit Record Review, Analysis, and Reporting (03.03.05) Audit Record Review, Analysis, and Reporting not implemented | Medium   | CUI Protection - Audit and Accountability |
| Audit Record Review, Analysis, and Reporting (03.03.05) partially implemented (POA&M)                                | Low      | CMMC certification risk                   |

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

- [ ] SSP documents Audit Record Review, Analysis, and Reporting (03.03.05) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
