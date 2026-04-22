---
name: "RA-6_technical-surveillance-countermeasures-survey"
description: "Employ a technical surveillance countermeasures survey at [organization-defined] [organization-defined]."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ra-6
  - ra
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

# RA-6 Technical Surveillance Countermeasures Survey

## High-Level Description

**Family:** Risk Assessment (RA)
**Framework:** NIST SP 800-53 Rev 5

A technical surveillance countermeasures survey is a service provided by qualified personnel to detect the presence of technical surveillance devices and hazards and to identify technical security weaknesses that could be used in the conduct of a technical penetration of the surveyed facility. Technical surveillance countermeasures surveys also provide evaluations of the technical security posture of organizations and facilities and include visual, electronic, and physical examinations of surveyed facilities, internally and externally. The surveys also provide useful input for risk assessments and information regarding organizational exposure to potential adversaries.

## What to Check

- [ ] Verify RA-6 Technical Surveillance Countermeasures Survey is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for RA-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for RA-6 implementation details. Verify the organization has documented how this control is satisfied.

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

Employ a technical surveillance countermeasures survey at [organization-defined] [organization-defined].

### Implementation Guidance

A technical surveillance countermeasures survey is a service provided by qualified personnel to detect the presence of technical surveillance devices and hazards and to identify technical security weaknesses that could be used in the conduct of a technical penetration of the surveyed facility. Technical surveillance countermeasures surveys also provide evaluations of the technical security posture of organizations and facilities and include visual, electronic, and physical examinations of surveyed facilities, internally and externally. The surveys also provide useful input for risk assessments and information regarding organizational exposure to potential adversaries.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RA-6 Technical Surveillance Countermeasures Survey not implemented | Medium | Risk Assessment |
| RA-6 partially implemented | Low | Incomplete Risk Assessment |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - RA-6](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ra-6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
