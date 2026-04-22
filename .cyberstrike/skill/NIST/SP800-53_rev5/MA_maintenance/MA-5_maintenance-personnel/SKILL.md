---
name: "MA-5_maintenance-personnel"
description: "Establish a process for maintenance personnel authorization and maintain a list of authorized maintenance organizations or personnel;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ma-5
  - ma
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with:
  - AC-2
  - AC-3
  - AC-5
  - AC-6
  - IA-2
  - IA-8
  - MA-4
  - MP-2
  - PE-2
  - PE-3
prerequisites: []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-5: "Chain with AC-5 for comprehensive security coverage"
---

# MA-5 Maintenance Personnel

## High-Level Description

**Family:** Maintenance (MA)
**Framework:** NIST SP 800-53 Rev 5

Maintenance personnel refers to individuals who perform hardware or software maintenance on organizational systems, while [PE-2](#pe-2) addresses physical access for individuals whose maintenance duties place them within the physical protection perimeter of the systems. Technical competence of supervising individuals relates to the maintenance performed on the systems, while having required access authorizations refers to maintenance on and near the systems. Individuals not previously identified as authorized maintenance personnel—such as information technology manufacturers, vendors, systems integrators, and consultants—may require privileged access to organizational systems, such as when they are required to conduct maintenance activities with little or no notice. Based on organizational assessments of risk, organizations may issue temporary credentials to these individuals. Temporary credentials may be for one-time use or for very limited time periods.

## What to Check

- [ ] Verify MA-5 Maintenance Personnel is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MA-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Establish a process for maintenance personnel authorization and maintain a list of authorized maintenance organizations or personnel;
Verify that non-escorted personnel performing maintenance on the system possess the required access authorizations; and
Designate organizational personnel with required access authorizations and technical competence to supervise the maintenance activities of personnel who do not possess the required access authorizations.

### Implementation Guidance

Maintenance personnel refers to individuals who perform hardware or software maintenance on organizational systems, while [PE-2](#pe-2) addresses physical access for individuals whose maintenance duties place them within the physical protection perimeter of the systems. Technical competence of supervising individuals relates to the maintenance performed on the systems, while having required access authorizations refers to maintenance on and near the systems. Individuals not previously identified as authorized maintenance personnel—such as information technology manufacturers, vendors, systems integrators, and consultants—may require privileged access to organizational systems, such as when they are required to conduct maintenance activities with little or no notice. Based on organizational assessments of risk, organizations may issue temporary credentials to these individuals. Temporary credentials may be for one-time use or for very limited time periods.

## Risk Assessment

| Finding                                    | Severity | Impact                 |
| ------------------------------------------ | -------- | ---------------------- |
| MA-5 Maintenance Personnel not implemented | Medium   | Maintenance            |
| MA-5 partially implemented                 | Low      | Incomplete Maintenance |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MA-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ma-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-3, AC-5, AC-6, IA-2) reviewed
