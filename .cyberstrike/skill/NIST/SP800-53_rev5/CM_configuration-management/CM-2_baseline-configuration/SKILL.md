---
name: "CM-2_baseline-configuration"
description: "Develop, document, and maintain under configuration control, a current baseline configuration of the system;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cm-2
  - cm
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
  - AU-6
  - CA-9
  - CM-1
  - CM-3
  - CM-5
  - CM-6
  - CM-8
  - CM-9
  - CP-9
prerequisites: []
severity_boost:
  AC-19: "Chain with AC-19 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
  CA-9: "Chain with CA-9 for comprehensive security coverage"
---

# CM-2 Baseline Configuration

## High-Level Description

**Family:** Configuration Management (CM)
**Framework:** NIST SP 800-53 Rev 5

Baseline configurations for systems and system components include connectivity, operational, and communications aspects of systems. Baseline configurations are documented, formally reviewed, and agreed-upon specifications for systems or configuration items within those systems. Baseline configurations serve as a basis for future builds, releases, or changes to systems and include security and privacy control implementations, operational procedures, information about system components, network topology, and logical placement of components in the system architecture. Maintaining baseline configurations requires creating new baselines as organizational systems change over time. Baseline configurations of systems reflect the current enterprise architecture.

## What to Check

- [ ] Verify CM-2 Baseline Configuration is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CM-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CM-2 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop, document, and maintain under configuration control, a current baseline configuration of the system; and
Review and update the baseline configuration of the system:
[organization-defined];
When required due to [organization-defined] ; and
When system components are installed or upgraded.

### Implementation Guidance

Baseline configurations for systems and system components include connectivity, operational, and communications aspects of systems. Baseline configurations are documented, formally reviewed, and agreed-upon specifications for systems or configuration items within those systems. Baseline configurations serve as a basis for future builds, releases, or changes to systems and include security and privacy control implementations, operational procedures, information about system components, network topology, and logical placement of components in the system architecture. Maintaining baseline configurations requires creating new baselines as organizational systems change over time. Baseline configurations of systems reflect the current enterprise architecture.

## Risk Assessment

| Finding                                     | Severity | Impact                              |
| ------------------------------------------- | -------- | ----------------------------------- |
| CM-2 Baseline Configuration not implemented | Medium   | Configuration Management            |
| CM-2 partially implemented                  | Low      | Incomplete Configuration Management |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - CM-2](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cm-2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-19, AU-6, CA-9, CM-1, CM-3) reviewed
