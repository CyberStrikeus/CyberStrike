---
name: "SA-10_developer-configuration-management"
description: "Require the developer of the system, system component, or system service to: Perform configuration management during system, component, or service [or"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-10
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CM-2
  - CM-3
  - CM-4
  - CM-7
  - CM-9
  - SA-4
  - SA-5
  - SA-8
  - SA-15
  - SI-2
prerequisites: []
severity_boost:
  CM-2: "Chain with CM-2 for comprehensive security coverage"
  CM-3: "Chain with CM-3 for comprehensive security coverage"
  CM-4: "Chain with CM-4 for comprehensive security coverage"
---

# SA-10 Developer Configuration Management

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Organizations consider the quality and completeness of configuration management activities conducted by developers as direct evidence of applying effective security controls. Controls include protecting the master copies of material used to generate security-relevant portions of the system hardware, software, and firmware from unauthorized modification or destruction. Maintaining the integrity of changes to the system, system component, or system service requires strict configuration control throughout the system development life cycle to track authorized changes and prevent unauthorized changes.

The configuration items that are placed under configuration management include the formal model; the functional, high-level, and low-level design specifications; other design data; implementation documentation; source code and hardware schematics; the current running version of the object code; tools for comparing new versions of security-relevant hardware descriptions and source code with previous versions; and test fixtures and documentation. Depending on the mission and business needs of organizations and the nature of the contractual relationships in place, developers may provide configuration management support during the operations and maintenance stage of the system development life cycle.

## What to Check

- [ ] Verify SA-10 Developer Configuration Management is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-10 implementation details. Verify the organization has documented how this control is satisfied.

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
Perform configuration management during system, component, or service [organization-defined];
Document, manage, and control the integrity of changes to [organization-defined];
Implement only organization-approved changes to the system, component, or service;
Document approved changes to the system, component, or service and the potential security and privacy impacts of such changes; and
Track security flaws and flaw resolution within the system, component, or service and report findings to [organization-defined].

### Implementation Guidance

Organizations consider the quality and completeness of configuration management activities conducted by developers as direct evidence of applying effective security controls. Controls include protecting the master copies of material used to generate security-relevant portions of the system hardware, software, and firmware from unauthorized modification or destruction. Maintaining the integrity of changes to the system, system component, or system service requires strict configuration control throughout the system development life cycle to track authorized changes and prevent unauthorized changes.

The configuration items that are placed under configuration management include the formal model; the functional, high-level, and low-level design specifications; other design data; implementation documentation; source code and hardware schematics; the current running version of the object code; tools for comparing new versions of security-relevant hardware descriptions and source code with previous versions; and test fixtures and documentation. Depending on the mission and business needs of organizations and the nature of the contractual relationships in place, developers may provide configuration management support during the operations and maintenance stage of the system development life cycle.

## Risk Assessment

| Finding                                                  | Severity | Impact                                     |
| -------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-10 Developer Configuration Management not implemented | Medium   | System and Services Acquisition            |
| SA-10 partially implemented                              | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-10](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-2, CM-3, CM-4, CM-7, CM-9) reviewed
