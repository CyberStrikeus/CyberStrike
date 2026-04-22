---
name: "PE-2_physical-access-authorizations"
description: "Develop, approve, and maintain a list of individuals with authorized access to the facility where the system resides;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-2
  - pe
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AT-3
  - AU-9
  - IA-4
  - MA-5
  - MP-2
  - PE-3
  - PE-4
  - PE-5
  - PE-8
  - PM-12
prerequisites:
  []
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  AU-9: "Chain with AU-9 for comprehensive security coverage"
  IA-4: "Chain with IA-4 for comprehensive security coverage"
---

# PE-2 Physical Access Authorizations

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Physical access authorizations apply to employees and visitors. Individuals with permanent physical access authorization credentials are not considered visitors. Authorization credentials include ID badges, identification cards, and smart cards. Organizations determine the strength of authorization credentials needed consistent with applicable laws, executive orders, directives, regulations, policies, standards, and guidelines. Physical access authorizations may not be necessary to access certain areas within facilities that are designated as publicly accessible.

## What to Check

- [ ] Verify PE-2 Physical Access Authorizations is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-2 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop, approve, and maintain a list of individuals with authorized access to the facility where the system resides;
Issue authorization credentials for facility access;
Review the access list detailing authorized facility access by individuals [organization-defined] ; and
Remove individuals from the facility access list when access is no longer required.

### Implementation Guidance

Physical access authorizations apply to employees and visitors. Individuals with permanent physical access authorization credentials are not considered visitors. Authorization credentials include ID badges, identification cards, and smart cards. Organizations determine the strength of authorization credentials needed consistent with applicable laws, executive orders, directives, regulations, policies, standards, and guidelines. Physical access authorizations may not be necessary to access certain areas within facilities that are designated as publicly accessible.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-2 Physical Access Authorizations not implemented | Medium | Physical and Environmental Protection |
| PE-2 partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-2](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3, AU-9, IA-4, MA-5, MP-2) reviewed
