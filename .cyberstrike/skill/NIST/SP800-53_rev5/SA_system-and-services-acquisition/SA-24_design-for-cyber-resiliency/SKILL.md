---
name: "SA-24_design-for-cyber-resiliency"
description: "Design organizational systems, system components, or system services to achieve cyber resiliency by: Defining the following cyber resiliency goals: [o"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-24
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CA-7
  - CP-2
  - CP-4
  - CP-9
  - CP-10
  - CP-11
  - CP-12
  - CP-13
  - IA-10
  - IR-4
prerequisites:
  []
severity_boost:
  CA-7: "Chain with CA-7 for comprehensive security coverage"
  CP-2: "Chain with CP-2 for comprehensive security coverage"
  CP-4: "Chain with CP-4 for comprehensive security coverage"
---

# SA-24 Design For Cyber Resiliency

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Cyber resiliency is critical to ensuring the survivability of mission critical systems and high value assets. Cyber resiliency focuses on limiting the damage from adversity or the conditions that can cause a loss of assets. Damage can affect: (1) organizations (e.g., loss of reputation, increased existential risk); (2) missions or business functions (e.g., decreased capability to complete current missions and to accomplish future missions); (3) security (e.g., decreased capability to achieve security objectives or to prevent, detect, and respond to cyber incidents); (4) systems (e.g., unauthorized use of system resources or decreased capability to meet system requirements); or (5) specific system elements (e.g., physical destruction; corruption, modification, or fabrication of information).

Cyber resiliency goals are intended to help organizations maintain a state of informed preparedness for adversity, continue essential mission or business functions despite adversity, restore mission or business functions during and after adversity, and modify mission or business functions and their supporting capabilities in response to predicted changes in technical, operational, or threat environments.

NIST SP 800-160, Volume 2 provides additional information on the Cyber Resiliency Engineering Framework to include detailed descriptions of cyber resiliency goals, objectives, techniques, implementation approaches, and design principles. NIST SP 800-160, Vol 1 provides additional information on achieving cyber resiliency as an emergent property of an engineered system.

## What to Check

- [ ] Verify SA-24 Design For Cyber Resiliency is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-24

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-24 implementation details. Verify the organization has documented how this control is satisfied.

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

Design organizational systems, system components, or system services to achieve cyber resiliency by:
Defining the following cyber resiliency goals: [organization-defined].
Defining the following cyber resiliency objectives: [organization-defined].
Defining the following cyber resiliency techniques: [organization-defined].
Defining the following cyber resiliency implementation approaches: [organization-defined].
Defining the following cyber resiliency design principles: [organization-defined].
Implement the selected cyber resiliency goals, objectives, techniques, implementation approaches, and design principles as part of an organizational risk management process or systems security engineering process.

### Implementation Guidance

Cyber resiliency is critical to ensuring the survivability of mission critical systems and high value assets. Cyber resiliency focuses on limiting the damage from adversity or the conditions that can cause a loss of assets. Damage can affect: (1) organizations (e.g., loss of reputation, increased existential risk); (2) missions or business functions (e.g., decreased capability to complete current missions and to accomplish future missions); (3) security (e.g., decreased capability to achieve security objectives or to prevent, detect, and respond to cyber incidents); (4) systems (e.g., unauthorized use of system resources or decreased capability to meet system requirements); or (5) specific system elements (e.g., physical destruction; corruption, modification, or fabrication of information).

Cyber resiliency goals are intended to help organizations maintain a state of informed preparedness for adversity, continue essential mission or business functions despite adversity, restore mission or business functions during and after adversity, and modify mission or business functions and their supporting capabilities in response to predicted changes in technical, operational, or threat environments.

NIST SP 800-160, Volume 2 provides additional information on the Cyber Resiliency Engineering Framework to include detailed descriptions of cyber resiliency goals, objectives, techniques, implementation approaches, and design principles. NIST SP 800-160, Vol 1 provides additional information on achieving cyber resiliency as an emergent property of an engineered system.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SA-24 Design For Cyber Resiliency not implemented | Medium | System and Services Acquisition |
| SA-24 partially implemented | Low | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - SA-24](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-24)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-7, CP-2, CP-4, CP-9, CP-10) reviewed
