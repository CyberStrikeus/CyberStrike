---
name: "Incident Monitoring, Reporting, and Response Assistance (03.06.02)_incident-monitoring-reporting-and-response-assistance"
description: "Track and document system security incidents."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - incident monitoring, reporting, and response assistance (03-06-02)
  - family-03.06
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Incident Monitoring, Reporting, and Response Assistance (03.06.02) Incident Monitoring, Reporting, and Response Assistance

## High-Level Description

**Family:** Incident Response
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Track and document system security incidents.
Report suspected incidents to the organizational incident response capability within [organization-defined].
Report incident information to [organization-defined].
Provide an incident response support resource that offers advice and assistance to system users on handling and reporting incidents.

## What to Check

- [ ] Verify Incident Monitoring, Reporting, and Response Assistance (03.06.02) Incident Monitoring, Reporting, and Response Assistance is implemented for CUI systems
- [ ] Review SSP documentation for Incident Monitoring, Reporting, and Response Assistance (03.06.02)
- [ ] Validate CMMC Level 2 assessment objective for Incident Monitoring, Reporting, and Response Assistance (03.06.02)
- [ ] Confirm POA&M addresses any gaps for Incident Monitoring, Reporting, and Response Assistance (03.06.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Incident Monitoring, Reporting, and Response Assistance (03.06.02) implementation description and responsible parties.

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

Track and document system security incidents.
Report suspected incidents to the organizational incident response capability within [organization-defined].
Report incident information to [organization-defined].
Provide an incident response support resource that offers advice and assistance to system users on handling and reporting incidents.

### Supplemental Guidance

Documenting incidents includes maintaining records about each incident, the status of the incident, and other pertinent information necessary for forensics as well as evaluating incident details, trends, and handling. Incident information can be obtained from many sources, including network monitoring, incident reports, incident response teams, user complaints, supply chain partners, audit monitoring, physical access monitoring, and user and administrator reports. [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.06.01)03.06.01 provides information on the types of incidents that are appropriate for monitoring. The types of incidents reported, the content and timeliness of the reports, and the reporting authorities reflect applicable laws, Executive Orders, directives, regulations, policies, standards, and guidelines. Incident information informs risk assessments, the effectiveness of security assessments, the security requirements for acquisitions, and the selection criteria for technology products. Incident response support resources provided by organizations include help desks, assistance groups, automated ticketing systems to open and track incident response tickets, and access to forensic services or consumer redress services, when required.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Incident Monitoring, Reporting, and Response Assistance (03.06.02) Incident Monitoring, Reporting, and Response Assistance not implemented | Medium | CUI Protection - Incident Response |
| Incident Monitoring, Reporting, and Response Assistance (03.06.02) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Incident Monitoring, Reporting, and Response Assistance (03.06.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
