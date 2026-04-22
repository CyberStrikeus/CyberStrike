---
name: "SA-4(9)_functions-ports-protocols-and-services-in-use"
description: "Require the developer of the system, system component, or system service to identify the functions, ports, protocols, and services intended for organi"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-4-9
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CM-7
  - SA-9
prerequisites:
  - SA-4
severity_boost:
  CM-7: "Chain with CM-7 for comprehensive security coverage"
  SA-9: "Chain with SA-9 for comprehensive security coverage"
---

# SA-4(9) Functions, Ports, Protocols, and Services in Use

> **Enhancement of:** SA-4

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

The identification of functions, ports, protocols, and services early in the system development life cycle (e.g., during the initial requirements definition and design stages) allows organizations to influence the design of the system, system component, or system service. This early involvement in the system development life cycle helps organizations avoid or minimize the use of functions, ports, protocols, or services that pose unnecessarily high risks and understand the trade-offs involved in blocking specific ports, protocols, or services or requiring system service providers to do so. Early identification of functions, ports, protocols, and services avoids costly retrofitting of controls after the system, component, or system service has been implemented. [SA-9](#sa-9) describes the requirements for external system services. Organizations identify which functions, ports, protocols, and services are provided from external sources.

## What to Check

- [ ] Verify SA-4(9) Functions, Ports, Protocols, and Services in Use is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-4(9)
- [ ] Verify enhancement builds upon base control SA-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-4(9) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to identify the functions, ports, protocols, and services intended for organizational use.

### Implementation Guidance

The identification of functions, ports, protocols, and services early in the system development life cycle (e.g., during the initial requirements definition and design stages) allows organizations to influence the design of the system, system component, or system service. This early involvement in the system development life cycle helps organizations avoid or minimize the use of functions, ports, protocols, or services that pose unnecessarily high risks and understand the trade-offs involved in blocking specific ports, protocols, or services or requiring system service providers to do so. Early identification of functions, ports, protocols, and services avoids costly retrofitting of controls after the system, component, or system service has been implemented. [SA-9](#sa-9) describes the requirements for external system services. Organizations identify which functions, ports, protocols, and services are provided from external sources.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SA-4(9) Functions, Ports, Protocols, and Services in Use not implemented | Medium | System and Services Acquisition |
| SA-4(9) partially implemented | Low | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - SA-4(9)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-4.9)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-7, SA-9) reviewed
