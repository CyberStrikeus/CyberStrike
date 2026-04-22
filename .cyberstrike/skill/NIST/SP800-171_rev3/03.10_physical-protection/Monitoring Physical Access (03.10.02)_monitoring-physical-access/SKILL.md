---
name: "Monitoring Physical Access (03.10.02)_monitoring-physical-access"
description: "Monitor physical access to the facility where the system resides to detect and respond to physical security incidents."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - monitoring physical access (03-10-02)
  - family-03.10
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Monitoring Physical Access (03.10.02) Monitoring Physical Access

## High-Level Description

**Family:** Physical Protection
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Monitor physical access to the facility where the system resides to detect and respond to physical security incidents.
Review physical access logs [organization-defined] and upon occurrence of [organization-defined].

## What to Check

- [ ] Verify Monitoring Physical Access (03.10.02) Monitoring Physical Access is implemented for CUI systems
- [ ] Review SSP documentation for Monitoring Physical Access (03.10.02)
- [ ] Validate CMMC Level 2 assessment objective for Monitoring Physical Access (03.10.02)
- [ ] Confirm POA&M addresses any gaps for Monitoring Physical Access (03.10.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Monitoring Physical Access (03.10.02) implementation description and responsible parties.

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

Monitor physical access to the facility where the system resides to detect and respond to physical security incidents.
Review physical access logs [organization-defined] and upon occurrence of [organization-defined].

### Supplemental Guidance

A facility can include one or more physical locations containing systems or system components that process, store, or transmit CUI. Physical access monitoring includes publicly accessible areas within organizational facilities. Examples of physical access monitoring include guards, video surveillance equipment (i.e., cameras), and sensor devices. Reviewing physical access logs can help to identify suspicious activities, anomalous events, or potential threats. The reviews can be supported by audit logging controls if the access logs are part of an automated system. Incident response capabilities include investigations of physical security incidents and responses to those incidents. Incidents include security violations or suspicious physical access activities, such as access outside of normal work hours, repeated access to areas not normally accessed, access for unusual lengths of time, and out-of-sequence access.

## Risk Assessment

| Finding                                                                          | Severity | Impact                               |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| Monitoring Physical Access (03.10.02) Monitoring Physical Access not implemented | Medium   | CUI Protection - Physical Protection |
| Monitoring Physical Access (03.10.02) partially implemented (POA&M)              | Low      | CMMC certification risk              |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Monitoring Physical Access (03.10.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
