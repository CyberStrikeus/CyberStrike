---
name: "PS-7_external-personnel-security"
description: "Establish personnel security requirements, including security roles and responsibilities for external providers;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-7
  - ps
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AT-2
  - AT-3
  - MA-5
  - PE-3
  - PS-2
  - PS-3
  - PS-4
  - PS-5
  - PS-6
  - SA-5
prerequisites: []
severity_boost:
  AT-2: "Chain with AT-2 for comprehensive security coverage"
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  MA-5: "Chain with MA-5 for comprehensive security coverage"
---

# PS-7 External Personnel Security

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

External provider refers to organizations other than the organization operating or acquiring the system. External providers include service bureaus, contractors, and other organizations that provide system development, information technology services, testing or assessment services, outsourced applications, and network/security management. Organizations explicitly include personnel security requirements in acquisition-related documents. External providers may have personnel working at organizational facilities with credentials, badges, or system privileges issued by organizations. Notifications of external personnel changes ensure the appropriate termination of privileges and credentials. Organizations define the transfers and terminations deemed reportable by security-related characteristics that include functions, roles, and the nature of credentials or privileges associated with transferred or terminated individuals.

## What to Check

- [ ] Verify PS-7 External Personnel Security is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-7 implementation details. Verify the organization has documented how this control is satisfied.

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

Establish personnel security requirements, including security roles and responsibilities for external providers;
Require external providers to comply with personnel security policies and procedures established by the organization;
Document personnel security requirements;
Require external providers to notify [organization-defined] of any personnel transfers or terminations of external personnel who possess organizational credentials and/or badges, or who have system privileges within [organization-defined] ; and
Monitor provider compliance with personnel security requirements.

### Implementation Guidance

External provider refers to organizations other than the organization operating or acquiring the system. External providers include service bureaus, contractors, and other organizations that provide system development, information technology services, testing or assessment services, outsourced applications, and network/security management. Organizations explicitly include personnel security requirements in acquisition-related documents. External providers may have personnel working at organizational facilities with credentials, badges, or system privileges issued by organizations. Notifications of external personnel changes ensure the appropriate termination of privileges and credentials. Organizations define the transfers and terminations deemed reportable by security-related characteristics that include functions, roles, and the nature of credentials or privileges associated with transferred or terminated individuals.

## Risk Assessment

| Finding                                          | Severity | Impact                        |
| ------------------------------------------------ | -------- | ----------------------------- |
| PS-7 External Personnel Security not implemented | Medium   | Personnel Security            |
| PS-7 partially implemented                       | Low      | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-7](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-2, AT-3, MA-5, PE-3, PS-2) reviewed
