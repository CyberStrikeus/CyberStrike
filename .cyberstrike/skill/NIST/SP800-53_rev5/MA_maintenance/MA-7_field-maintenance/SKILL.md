---
name: "MA-7_field-maintenance"
description: "Restrict or prohibit field maintenance on [organization-defined] to [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ma-7
  - ma
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with:
  - MA-2
  - MA-4
  - MA-5
prerequisites: []
severity_boost:
  MA-2: "Chain with MA-2 for comprehensive security coverage"
  MA-4: "Chain with MA-4 for comprehensive security coverage"
  MA-5: "Chain with MA-5 for comprehensive security coverage"
---

# MA-7 Field Maintenance

## High-Level Description

**Family:** Maintenance (MA)
**Framework:** NIST SP 800-53 Rev 5

Field maintenance is the type of maintenance conducted on a system or system component after the system or component has been deployed to a specific site (i.e., operational environment). In certain instances, field maintenance (i.e., local maintenance at the site) may not be executed with the same degree of rigor or with the same quality control checks as depot maintenance. For critical systems designated as such by the organization, it may be necessary to restrict or prohibit field maintenance at the local site and require that such maintenance be conducted in trusted facilities with additional controls.

## What to Check

- [ ] Verify MA-7 Field Maintenance is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MA-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MA-7 implementation details. Verify the organization has documented how this control is satisfied.

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

Restrict or prohibit field maintenance on [organization-defined] to [organization-defined].

### Implementation Guidance

Field maintenance is the type of maintenance conducted on a system or system component after the system or component has been deployed to a specific site (i.e., operational environment). In certain instances, field maintenance (i.e., local maintenance at the site) may not be executed with the same degree of rigor or with the same quality control checks as depot maintenance. For critical systems designated as such by the organization, it may be necessary to restrict or prohibit field maintenance at the local site and require that such maintenance be conducted in trusted facilities with additional controls.

## Risk Assessment

| Finding                                | Severity | Impact                 |
| -------------------------------------- | -------- | ---------------------- |
| MA-7 Field Maintenance not implemented | Medium   | Maintenance            |
| MA-7 partially implemented             | Low      | Incomplete Maintenance |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MA-7](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ma-7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (MA-2, MA-4, MA-5) reviewed
