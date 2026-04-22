---
name: "System Component Inventory (03.04.10)_system-component-inventory"
description: "Develop and document an inventory of system components."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - system component inventory (03-04-10)
  - family-03.04
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-16
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# System Component Inventory (03.04.10) System Component Inventory

## High-Level Description

**Family:** Configuration Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Develop and document an inventory of system components.
Review and update the system component inventory [organization-defined].
Update the system component inventory as part of installations, removals, and system updates.

## What to Check

- [ ] Verify System Component Inventory (03.04.10) System Component Inventory is implemented for CUI systems
- [ ] Review SSP documentation for System Component Inventory (03.04.10)
- [ ] Validate CMMC Level 2 assessment objective for System Component Inventory (03.04.10)
- [ ] Confirm POA&M addresses any gaps for System Component Inventory (03.04.10)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for System Component Inventory (03.04.10) implementation description and responsible parties.

### Step 2: Assess Implementation

```
# Verify security controls protecting CUI
# Check access controls, encryption, monitoring as applicable

# For Linux systems:
ls -la /etc/security/ 2>/dev/null
grep -r "CUI\|controlled" /etc/security/ 2>/dev/null

# For cloud:
# Use cloud-audit-mcp tools to assess posture
```

### Step 3: CMMC Assessment Validation

Verify this requirement passes CMMC Level 2 assessment methodology per SP 800-171A Rev 3.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools |
| Manual Review | SSP and POA&M review | Documentation analysis |

## Remediation Guide

### Requirement Statement

Develop and document an inventory of system components.
Review and update the system component inventory [organization-defined].
Update the system component inventory as part of installations, removals, and system updates.

### Supplemental Guidance

System components are discrete, identifiable assets (i.e., hardware, software, and firmware elements) that compose a system. Organizations may implement centralized system component inventories that include components from all systems. In such situations, organizations ensure that the inventories include the system-specific information required for component accountability. The information necessary for effective accountability of system components includes the system name, software owners, software version numbers, software license information, hardware inventory specifications, and — for networked components — the machine names and network addresses for all implemented protocols (e.g., IPv4, IPv6). Inventory specifications include component type, physical location, date of receipt, manufacturer, cost, model, serial number, and supplier information.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Component Inventory (03.04.10) System Component Inventory not implemented | Medium | CUI Protection - Configuration Management |
| System Component Inventory (03.04.10) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents System Component Inventory (03.04.10) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
