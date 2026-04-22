---
name: "PE-3_physical-access-control"
description: "Enforce physical access authorizations at [organization-defined] by: Verifying individual access authorizations before granting access to the facility"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-3
  - pe
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AT-3
  - AU-2
  - AU-6
  - AU-9
  - AU-13
  - CP-10
  - IA-3
  - IA-8
  - MA-5
  - MP-2
prerequisites: []
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  AU-2: "Chain with AU-2 for comprehensive security coverage"
  AU-6: "Chain with AU-6 for comprehensive security coverage"
---

# PE-3 Physical Access Control

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Physical access control applies to employees and visitors. Individuals with permanent physical access authorizations are not considered visitors. Physical access controls for publicly accessible areas may include physical access control logs/records, guards, or physical access devices and barriers to prevent movement from publicly accessible areas to non-public areas. Organizations determine the types of guards needed, including professional security staff, system users, or administrative staff. Physical access devices include keys, locks, combinations, biometric readers, and card readers. Physical access control systems comply with applicable laws, executive orders, directives, policies, regulations, standards, and guidelines. Organizations have flexibility in the types of audit logs employed. Audit logs can be procedural, automated, or some combination thereof. Physical access points can include facility access points, interior access points to systems that require supplemental access controls, or both. Components of systems may be in areas designated as publicly accessible with organizations controlling access to the components.

## What to Check

- [ ] Verify PE-3 Physical Access Control is documented in SSP
- [ ] Validate all 8 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-3 implementation details. Verify the organization has documented how this control is satisfied.

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

Enforce physical access authorizations at [organization-defined] by:
Verifying individual access authorizations before granting access to the facility; and
Controlling ingress and egress to the facility using [organization-defined];
Maintain physical access audit logs for [organization-defined];
Control access to areas within the facility designated as publicly accessible by implementing the following controls: [organization-defined];
Escort visitors and control visitor activity [organization-defined];
Secure keys, combinations, and other physical access devices;
Inventory [organization-defined] every [organization-defined] ; and
Change combinations and keys [organization-defined] and/or when keys are lost, combinations are compromised, or when individuals possessing the keys or combinations are transferred or terminated.

### Implementation Guidance

Physical access control applies to employees and visitors. Individuals with permanent physical access authorizations are not considered visitors. Physical access controls for publicly accessible areas may include physical access control logs/records, guards, or physical access devices and barriers to prevent movement from publicly accessible areas to non-public areas. Organizations determine the types of guards needed, including professional security staff, system users, or administrative staff. Physical access devices include keys, locks, combinations, biometric readers, and card readers. Physical access control systems comply with applicable laws, executive orders, directives, policies, regulations, standards, and guidelines. Organizations have flexibility in the types of audit logs employed. Audit logs can be procedural, automated, or some combination thereof. Physical access points can include facility access points, interior access points to systems that require supplemental access controls, or both. Components of systems may be in areas designated as publicly accessible with organizations controlling access to the components.

## Risk Assessment

| Finding                                      | Severity | Impact                                           |
| -------------------------------------------- | -------- | ------------------------------------------------ |
| PE-3 Physical Access Control not implemented | Medium   | Physical and Environmental Protection            |
| PE-3 partially implemented                   | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-3](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3, AU-2, AU-6, AU-9, AU-13) reviewed
