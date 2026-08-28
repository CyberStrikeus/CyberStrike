---
name: "PE-6(4)_monitoring-physical-access-to-systems"
description: "Monitor physical access to the system in addition to the physical access monitoring of the facility at [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-6-4
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - PE-6
severity_boost: {}
---

# PE-6(4) Monitoring Physical Access to Systems

> **Enhancement of:** PE-6

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Monitoring physical access to systems provides additional monitoring for those areas within facilities where there is a concentration of system components, including server rooms, media storage areas, and communications centers. Physical access monitoring can be coordinated with intrusion detection systems and system monitoring capabilities to provide comprehensive and integrated threat coverage for the organization.

## What to Check

- [ ] Verify PE-6(4) Monitoring Physical Access to Systems is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-6(4)
- [ ] Verify enhancement builds upon base control PE-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-6(4) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool          | Purpose                           | Usage |
| ------------- | --------------------------------- | ----- |
| Manual Review | Documentation and interview-based | N/A   |

## Remediation Guide

### Control Statement

Monitor physical access to the system in addition to the physical access monitoring of the facility at [organization-defined].

### Implementation Guidance

Monitoring physical access to systems provides additional monitoring for those areas within facilities where there is a concentration of system components, including server rooms, media storage areas, and communications centers. Physical access monitoring can be coordinated with intrusion detection systems and system monitoring capabilities to provide comprehensive and integrated threat coverage for the organization.

## Risk Assessment

| Finding                                                       | Severity | Impact                                           |
| ------------------------------------------------------------- | -------- | ------------------------------------------------ |
| PE-6(4) Monitoring Physical Access to Systems not implemented | Medium   | Physical and Environmental Protection            |
| PE-6(4) partially implemented                                 | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-6(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-6.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
