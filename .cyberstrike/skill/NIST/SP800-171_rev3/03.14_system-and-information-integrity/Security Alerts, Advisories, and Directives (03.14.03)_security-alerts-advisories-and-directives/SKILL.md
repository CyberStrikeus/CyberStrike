---
name: "Security Alerts, Advisories, and Directives (03.14.03)_security-alerts-advisories-and-directives"
description: "Receive system security alerts, advisories, and directives from external organizations on an ongoing basis."
category: "input-validation"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - security alerts, advisories, and directives (03-14-03)
  - family-03.14
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Security Alerts, Advisories, and Directives (03.14.03) Security Alerts, Advisories, and Directives

## High-Level Description

**Family:** System and Information Integrity
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Receive system security alerts, advisories, and directives from external organizations on an ongoing basis.
Generate and disseminate internal system security alerts, advisories, and directives, as necessary.

## What to Check

- [ ] Verify Security Alerts, Advisories, and Directives (03.14.03) Security Alerts, Advisories, and Directives is implemented for CUI systems
- [ ] Review SSP documentation for Security Alerts, Advisories, and Directives (03.14.03)
- [ ] Validate CMMC Level 2 assessment objective for Security Alerts, Advisories, and Directives (03.14.03)
- [ ] Confirm POA&M addresses any gaps for Security Alerts, Advisories, and Directives (03.14.03)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Security Alerts, Advisories, and Directives (03.14.03) implementation description and responsible parties.

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

Receive system security alerts, advisories, and directives from external organizations on an ongoing basis.
Generate and disseminate internal system security alerts, advisories, and directives, as necessary.

### Supplemental Guidance

There are many publicly available sources of system security alerts and advisories. The Department of Homeland Security’s Cybersecurity and Infrastructure Security Agency (CISA), the National Security Agency (NSA), and the Federal Bureau of Investigation (FBI) generate security alerts and advisories to maintain situational awareness across the Federal Government and in nonfederal organizations. Software vendors, subscription services, and industry Information Sharing and Analysis Centers (ISACs) may also provide security alerts and advisories. Compliance with security directives is essential due to the critical nature of many of these directives and the potential immediate adverse effects on organizational operations and assets, individuals, other organizations, and the Nation should the directives not be implemented in a timely manner.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Security Alerts, Advisories, and Directives (03.14.03) Security Alerts, Advisories, and Directives not implemented | High | CUI Protection - System and Information Integrity |
| Security Alerts, Advisories, and Directives (03.14.03) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Security Alerts, Advisories, and Directives (03.14.03) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
