---
name: "PS-6_access-agreements"
description: "Develop and document access agreements for organizational systems;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ps-6
  - ps
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AC-17
  - PE-2
  - PL-4
  - PS-2
  - PS-3
  - PS-6
  - PS-7
  - PS-8
  - SA-21
  - SI-12
prerequisites: []
severity_boost:
  AC-17: "Chain with AC-17 for comprehensive security coverage"
  PE-2: "Chain with PE-2 for comprehensive security coverage"
  PL-4: "Chain with PL-4 for comprehensive security coverage"
---

# PS-6 Access Agreements

## High-Level Description

**Family:** Personnel Security (PS)
**Framework:** NIST SP 800-53 Rev 5

Access agreements include nondisclosure agreements, acceptable use agreements, rules of behavior, and conflict-of-interest agreements. Signed access agreements include an acknowledgement that individuals have read, understand, and agree to abide by the constraints associated with organizational systems to which access is authorized. Organizations can use electronic signatures to acknowledge access agreements unless specifically prohibited by organizational policy.

## What to Check

- [ ] Verify PS-6 Access Agreements is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PS-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PS-6 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop and document access agreements for organizational systems;
Review and update the access agreements [organization-defined] ; and
Verify that individuals requiring access to organizational information and systems:
Sign appropriate access agreements prior to being granted access; and
Re-sign access agreements to maintain access to organizational systems when access agreements have been updated or [organization-defined].

### Implementation Guidance

Access agreements include nondisclosure agreements, acceptable use agreements, rules of behavior, and conflict-of-interest agreements. Signed access agreements include an acknowledgement that individuals have read, understand, and agree to abide by the constraints associated with organizational systems to which access is authorized. Organizations can use electronic signatures to acknowledge access agreements unless specifically prohibited by organizational policy.

## Risk Assessment

| Finding                                | Severity | Impact                        |
| -------------------------------------- | -------- | ----------------------------- |
| PS-6 Access Agreements not implemented | Medium   | Personnel Security            |
| PS-6 partially implemented             | Low      | Incomplete Personnel Security |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PS-6](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ps-6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-17, PE-2, PL-4, PS-2, PS-3) reviewed
