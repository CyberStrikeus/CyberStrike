---
name: "MA-2_controlled-maintenance"
description: "Schedule, document, and review records of maintenance, repair, and replacement on system components in accordance with manufacturer or vendor speci..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ma-2
  - ma
tech_stack:
  - linux
  - windows
cwe_ids:
  []
chains_with:
  - CM-2
  - CM-3
  - CM-4
  - CM-5
  - CM-8
  - MA-4
  - MP-6
  - PE-16
  - SI-2
  - SR-3
prerequisites:
  []
severity_boost:
  CM-2: "Chain with CM-2 for comprehensive security coverage"
  CM-3: "Chain with CM-3 for comprehensive security coverage"
  CM-4: "Chain with CM-4 for comprehensive security coverage"
---

# MA-2 Controlled Maintenance

## High-Level Description

**Family:** Maintenance (MA)
**Framework:** NIST SP 800-53 Rev 5

Controlling system maintenance addresses the information security aspects of the system maintenance program and applies to all types of maintenance to system components conducted by local or nonlocal entities. Maintenance includes peripherals such as scanners, copiers, and printers. Information necessary for creating effective maintenance records includes the date and time of maintenance, a description of the maintenance performed, names of the individuals or group performing the maintenance, name of the escort, and system components or equipment that are removed or replaced. Organizations consider supply chain-related risks associated with replacement components for systems.

## What to Check

- [ ] Verify MA-2 Controlled Maintenance is documented in SSP
- [ ] Validate all 6 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MA-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MA-2 implementation details. Verify the organization has documented how this control is satisfied.

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

Schedule, document, and review records of maintenance, repair, and replacement on system components in accordance with manufacturer or vendor specifications and/or organizational requirements;
Approve and monitor all maintenance activities, whether performed on site or remotely and whether the system or system components are serviced on site or removed to another location;
Require that [organization-defined] explicitly approve the removal of the system or system components from organizational facilities for off-site maintenance, repair, or replacement;
Sanitize equipment to remove the following information from associated media prior to removal from organizational facilities for off-site maintenance, repair, or replacement: [organization-defined];
Check all potentially impacted controls to verify that the controls are still functioning properly following maintenance, repair, or replacement actions; and
Include the following information in organizational maintenance records: [organization-defined].

### Implementation Guidance

Controlling system maintenance addresses the information security aspects of the system maintenance program and applies to all types of maintenance to system components conducted by local or nonlocal entities. Maintenance includes peripherals such as scanners, copiers, and printers. Information necessary for creating effective maintenance records includes the date and time of maintenance, a description of the maintenance performed, names of the individuals or group performing the maintenance, name of the escort, and system components or equipment that are removed or replaced. Organizations consider supply chain-related risks associated with replacement components for systems.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| MA-2 Controlled Maintenance not implemented | Medium | Maintenance |
| MA-2 partially implemented | Low | Incomplete Maintenance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MA-2](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ma-2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-2, CM-3, CM-4, CM-5, CM-8) reviewed
