---
name: "SA-4(5)_system-component-and-service-configurations"
description: "Require the developer of the system, system component, or system service to: Deliver the system, component, or service with [organization-defined] imp"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-4-5
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with: []
prerequisites:
  - SA-4
severity_boost: {}
---

# SA-4(5) System, Component, and Service Configurations

> **Enhancement of:** SA-4

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Examples of security configurations include the U.S. Government Configuration Baseline (USGCB), Security Technical Implementation Guides (STIGs), and any limitations on functions, ports, protocols, and services. Security characteristics can include requiring that default passwords have been changed.

## What to Check

- [ ] Verify SA-4(5) System, Component, and Service Configurations is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-4(5)
- [ ] Verify enhancement builds upon base control SA-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-4(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to:
Deliver the system, component, or service with [organization-defined] implemented; and
Use the configurations as the default for any subsequent system, component, or service reinstallation or upgrade.

### Implementation Guidance

Examples of security configurations include the U.S. Government Configuration Baseline (USGCB), Security Technical Implementation Guides (STIGs), and any limitations on functions, ports, protocols, and services. Security characteristics can include requiring that default passwords have been changed.

## Risk Assessment

| Finding                                                               | Severity | Impact                                     |
| --------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-4(5) System, Component, and Service Configurations not implemented | Medium   | System and Services Acquisition            |
| SA-4(5) partially implemented                                         | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-4(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-4.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
