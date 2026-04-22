---
name: "CM-5(5)_privilege-limitation-for-production-and-operation"
description: "Limit privileges to change system components and system-related information within a production or operational environment;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-5-5
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
  - AC-2
prerequisites:
  - CM-5
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
---

# CM-5(5) Privilege Limitation for Production and Operation

> **Enhancement of:** CM-5

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

In many organizations, systems support multiple mission and business functions. Limiting privileges to change system components with respect to operational systems is necessary because changes to a system component may have far-reaching effects on mission and business processes supported by the system. The relationships between systems and mission/business processes are, in some cases, unknown to developers. System-related information includes operational procedures.

## What to Check

- [ ] Verify CM-5(5) Privilege Limitation for Production and Operation is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-5(5)
- [ ] Verify enhancement builds upon base control CM-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-5(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Limit privileges to change system components and system-related information within a production or operational environment; and
Review and reevaluate privileges [organization-defined].

### Implementation Guidance

In many organizations, systems support multiple mission and business functions. Limiting privileges to change system components with respect to operational systems is necessary because changes to a system component may have far-reaching effects on mission and business processes supported by the system. The relationships between systems and mission/business processes are, in some cases, unknown to developers. System-related information includes operational procedures.

## Risk Assessment

| Finding                                                                   | Severity | Impact                              |
| ------------------------------------------------------------------------- | -------- | ----------------------------------- |
| CM-5(5) Privilege Limitation for Production and Operation not implemented | Medium   | Configuration Management            |
| CM-5(5) partially implemented                                             | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-5(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-5.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2) reviewed
