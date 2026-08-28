---
name: "CM-8(3)_automated-unauthorized-component-detection"
description: "Detect the presence of unauthorized hardware, software, and firmware components within the system using [organization-defined] [organization-define..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-8-3
  - cm
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  - AC-19
  - CA-7
  - RA-5
  - SC-3
  - SC-39
  - SC-44
  - SI-3
  - SI-4
  - SI-7
prerequisites:
  - CM-8
severity_boost:
  AC-19: "Chain with AC-19 for comprehensive security coverage"
  CA-7: "Chain with CA-7 for comprehensive security coverage"
  RA-5: "Chain with RA-5 for comprehensive security coverage"
---

# CM-8(3) Automated Unauthorized Component Detection

> **Enhancement of:** CM-8

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Automated unauthorized component detection is applied in addition to the monitoring for unauthorized remote connections and mobile devices. Monitoring for unauthorized system components may be accomplished on an ongoing basis or by the periodic scanning of systems for that purpose. Automated mechanisms may also be used to prevent the connection of unauthorized components (see [CM-7(9)](#cm-7.9) ). Automated mechanisms can be implemented in systems or in separate system components. When acquiring and implementing automated mechanisms, organizations consider whether such mechanisms depend on the ability of the system component to support an agent or supplicant in order to be detected since some types of components do not have or cannot support agents (e.g., IoT devices, sensors). Isolation can be achieved , for example, by placing unauthorized system components in separate domains or subnets or quarantining such components. This type of component isolation is commonly referred to as "sandboxing."

## What to Check

- [ ] Verify CM-8(3) Automated Unauthorized Component Detection is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-8(3)
- [ ] Verify enhancement builds upon base control CM-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-8(3) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                       | Usage                                     |
| --------------- | ----------------------------- | ----------------------------------------- |
| cloud-audit-mcp | Check configuration baselines | `cloud_audit_config`                      |
| AWS CLI         | Review Config rules           | `aws configservice describe-config-rules` |

## Remediation Guide

### Control Statement

Detect the presence of unauthorized hardware, software, and firmware components within the system using [organization-defined] [organization-defined] ; and
Take the following actions when unauthorized components are detected: [organization-defined].

### Implementation Guidance

Automated unauthorized component detection is applied in addition to the monitoring for unauthorized remote connections and mobile devices. Monitoring for unauthorized system components may be accomplished on an ongoing basis or by the periodic scanning of systems for that purpose. Automated mechanisms may also be used to prevent the connection of unauthorized components (see [CM-7(9)](#cm-7.9) ). Automated mechanisms can be implemented in systems or in separate system components. When acquiring and implementing automated mechanisms, organizations consider whether such mechanisms depend on the ability of the system component to support an agent or supplicant in order to be detected since some types of components do not have or cannot support agents (e.g., IoT devices, sensors). Isolation can be achieved , for example, by placing unauthorized system components in separate domains or subnets or quarantining such components. This type of component isolation is commonly referred to as "sandboxing."

## Risk Assessment

| Finding                                                            | Severity | Impact                              |
| ------------------------------------------------------------------ | -------- | ----------------------------------- |
| CM-8(3) Automated Unauthorized Component Detection not implemented | Medium   | Configuration Management            |
| CM-8(3) partially implemented                                      | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-8(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-8.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-19, CA-7, RA-5, SC-3, SC-39) reviewed
