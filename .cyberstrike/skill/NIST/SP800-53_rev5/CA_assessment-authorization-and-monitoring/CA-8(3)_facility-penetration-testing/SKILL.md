---
name: "CA-8(3)_facility-penetration-testing"
description: "Employ a penetration testing process that includes [organization-defined] [organization-defined] attempts to bypass or circumvent controls associated "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ca-8-3
  - ca
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CA-2
  - PE-3
prerequisites:
  - CA-8
severity_boost:
  CA-2: "Chain with CA-2 for comprehensive security coverage"
  PE-3: "Chain with PE-3 for comprehensive security coverage"
---

# CA-8(3) Facility Penetration Testing

> **Enhancement of:** CA-8

## High-Level Description

**Family:** Assessment, Authorization, and Monitoring (CA)
**Framework:** NIST SP 800-53 Rev 5

Penetration testing of physical access points can provide information on critical vulnerabilities in the operating environments of organizational systems. Such information can be used to correct weaknesses or deficiencies in physical controls that are necessary to protect organizational systems.

## What to Check

- [ ] Verify CA-8(3) Facility Penetration Testing is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CA-8(3)
- [ ] Verify enhancement builds upon base control CA-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CA-8(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ a penetration testing process that includes [organization-defined] [organization-defined] attempts to bypass or circumvent controls associated with physical access points to the facility.

### Implementation Guidance

Penetration testing of physical access points can provide information on critical vulnerabilities in the operating environments of organizational systems. Such information can be used to correct weaknesses or deficiencies in physical controls that are necessary to protect organizational systems.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CA-8(3) Facility Penetration Testing not implemented | Medium | Assessment, Authorization, and Monitoring |
| CA-8(3) partially implemented | Low | Incomplete Assessment, Authorization, and Monitoring |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CA-8(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ca-8.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-2, PE-3) reviewed
