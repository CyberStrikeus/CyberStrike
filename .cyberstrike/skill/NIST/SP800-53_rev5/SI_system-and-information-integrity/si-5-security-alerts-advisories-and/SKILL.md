---
name: "SI-5_security-alerts-advisories-and-directives"
description: "Receive system security alerts, advisories, and directives from [organization-defined] on an ongoing basis;"
category: "input-validation"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - si-5
  - si
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - PM-15
  - RA-5
  - SI-2
prerequisites: []
severity_boost:
  PM-15: "Chain with PM-15 for comprehensive security coverage"
  RA-5: "Chain with RA-5 for comprehensive security coverage"
  SI-2: "Chain with SI-2 for comprehensive security coverage"
---

# SI-5 Security Alerts, Advisories, and Directives

## High-Level Description

**Family:** System and Information Integrity (SI)
**Framework:** NIST SP 800-53 Rev 5

The Cybersecurity and Infrastructure Security Agency (CISA) generates security alerts and advisories to maintain situational awareness throughout the Federal Government. Security directives are issued by OMB or other designated organizations with the responsibility and authority to issue such directives. Compliance with security directives is essential due to the critical nature of many of these directives and the potential (immediate) adverse effects on organizational operations and assets, individuals, other organizations, and the Nation should the directives not be implemented in a timely manner. External organizations include supply chain partners, external mission or business partners, external service providers, and other peer or supporting organizations.

## What to Check

- [ ] Verify SI-5 Security Alerts, Advisories, and Directives is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SI-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SI-5 implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                    | Usage                          |
| --------------- | -------------------------- | ------------------------------ |
| cloud-audit-mcp | Check integrity monitoring | `cloud_audit_monitoring`       |
| AWS CLI         | Review GuardDuty/Inspector | `aws guardduty list-detectors` |

## Remediation Guide

### Control Statement

Receive system security alerts, advisories, and directives from [organization-defined] on an ongoing basis;
Generate internal security alerts, advisories, and directives as deemed necessary;
Disseminate security alerts, advisories, and directives to: [organization-defined] ; and
Implement security directives in accordance with established time frames, or notify the issuing organization of the degree of noncompliance.

### Implementation Guidance

The Cybersecurity and Infrastructure Security Agency (CISA) generates security alerts and advisories to maintain situational awareness throughout the Federal Government. Security directives are issued by OMB or other designated organizations with the responsibility and authority to issue such directives. Compliance with security directives is essential due to the critical nature of many of these directives and the potential (immediate) adverse effects on organizational operations and assets, individuals, other organizations, and the Nation should the directives not be implemented in a timely manner. External organizations include supply chain partners, external mission or business partners, external service providers, and other peer or supporting organizations.

## Risk Assessment

| Finding                                                          | Severity | Impact                                      |
| ---------------------------------------------------------------- | -------- | ------------------------------------------- |
| SI-5 Security Alerts, Advisories, and Directives not implemented | High     | System and Information Integrity            |
| SI-5 partially implemented                                       | Medium   | Incomplete System and Information Integrity |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [NIST SP 800-53 Rev 5 - SI-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=si-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PM-15, RA-5, SI-2) reviewed
