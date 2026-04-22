---
name: "PS-5_personnel-transfer"
description: "Review and confirm ongoing operational need for current logical and physical access authorizations to systems and facilities when individuals are r..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-5
  - ps
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AC-2
  - IA-4
  - PE-2
  - PM-12
  - PS-4
  - PS-7
prerequisites: []
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  IA-4: "Chain with IA-4 for comprehensive security coverage"
  PE-2: "Chain with PE-2 for comprehensive security coverage"
---

# PS-5 Personnel Transfer

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

Personnel transfer applies when reassignments or transfers of individuals are permanent or of such extended duration as to make the actions warranted. Organizations define actions appropriate for the types of reassignments or transfers, whether permanent or extended. Actions that may be required for personnel transfers or reassignments to other positions within organizations include returning old and issuing new keys, identification cards, and building passes; closing system accounts and establishing new accounts; changing system access authorizations (i.e., privileges); and providing for access to official records to which individuals had access at previous work locations and in previous system accounts.

## What to Check

- [ ] Verify PS-5 Personnel Transfer is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Review and confirm ongoing operational need for current logical and physical access authorizations to systems and facilities when individuals are reassigned or transferred to other positions within the organization;
Initiate [organization-defined] within [organization-defined];
Modify access authorization as needed to correspond with any changes in operational need due to reassignment or transfer; and
Notify [organization-defined] within [organization-defined].

### Implementation Guidance

Personnel transfer applies when reassignments or transfers of individuals are permanent or of such extended duration as to make the actions warranted. Organizations define actions appropriate for the types of reassignments or transfers, whether permanent or extended. Actions that may be required for personnel transfers or reassignments to other positions within organizations include returning old and issuing new keys, identification cards, and building passes; closing system accounts and establishing new accounts; changing system access authorizations (i.e., privileges); and providing for access to official records to which individuals had access at previous work locations and in previous system accounts.

## Risk Assessment

| Finding                                 | Severity | Impact                        |
| --------------------------------------- | -------- | ----------------------------- |
| PS-5 Personnel Transfer not implemented | Medium   | Personnel Security            |
| PS-5 partially implemented              | Low      | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, IA-4, PE-2, PM-12, PS-4) reviewed
