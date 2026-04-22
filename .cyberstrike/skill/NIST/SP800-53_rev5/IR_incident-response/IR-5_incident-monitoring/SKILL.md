---
name: "IR-5_incident-monitoring"
description: "Track and document incidents."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ir-5
  - ir
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AU-6
  - AU-7
  - IR-4
  - IR-6
  - IR-8
  - PE-6
  - PM-5
  - SC-5
  - SC-7
  - SI-3
prerequisites:
  []
severity_boost:
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  AU-7: "Chain with AU-7 for comprehensive security coverage"
  IR-4: "Chain with IR-4 for comprehensive security coverage"
---

# IR-5 Incident Monitoring

## High-Level Description

**Family:** Incident Response (IR)
**Framework:** NIST SP 800-53 Rev 5

Documenting incidents includes maintaining records about each incident, the status of the incident, and other pertinent information necessary for forensics as well as evaluating incident details, trends, and handling. Incident information can be obtained from a variety of sources, including network monitoring, incident reports, incident response teams, user complaints, supply chain partners, audit monitoring, physical access monitoring, and user and administrator reports. [IR-4](#ir-4) provides information on the types of incidents that are appropriate for monitoring.

## What to Check

- [ ] Verify IR-5 Incident Monitoring is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IR-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IR-5 implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Track and document incidents.

### Implementation Guidance

Documenting incidents includes maintaining records about each incident, the status of the incident, and other pertinent information necessary for forensics as well as evaluating incident details, trends, and handling. Incident information can be obtained from a variety of sources, including network monitoring, incident reports, incident response teams, user complaints, supply chain partners, audit monitoring, physical access monitoring, and user and administrator reports. [IR-4](#ir-4) provides information on the types of incidents that are appropriate for monitoring.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IR-5 Incident Monitoring not implemented | Medium | Incident Response |
| IR-5 partially implemented | Low | Incomplete Incident Response |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - IR-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ir-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-6, AU-7, IR-4, IR-6, IR-8) reviewed
