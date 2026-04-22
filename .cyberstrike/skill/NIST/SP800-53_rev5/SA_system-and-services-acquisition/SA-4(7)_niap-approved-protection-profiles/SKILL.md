---
name: "SA-4(7)_niap-approved-protection-profiles"
description: "Limit the use of commercially provided information assurance and information assurance-enabled information technology products to those products th..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-4-7
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - IA-7
  - SC-12
  - SC-13
prerequisites:
  - SA-4
severity_boost:
  IA-7: "Chain with IA-7 for comprehensive security coverage"
  SC-12: "Chain with SC-12 for comprehensive security coverage"
  SC-13: "Chain with SC-13 for comprehensive security coverage"
---

# SA-4(7) NIAP-approved Protection Profiles 

> **Enhancement of:** SA-4

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

See [NIAP CCEVS](#795aff72-3e6c-4b6b-a80a-b14d84b7f544) for additional information on NIAP. See [NIST CMVP](#1acdc775-aafb-4d11-9341-dc6a822e9d38) for additional information on FIPS-validated cryptographic modules.

## What to Check

- [ ] Verify SA-4(7) NIAP-approved Protection Profiles  is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-4(7)
- [ ] Verify enhancement builds upon base control SA-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-4(7) implementation details. Verify the organization has documented how this control is satisfied.

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

Limit the use of commercially provided information assurance and information assurance-enabled information technology products to those products that have been successfully evaluated against a National Information Assurance partnership (NIAP)-approved Protection Profile for a specific technology type, if such a profile exists; and
Require, if no NIAP-approved Protection Profile exists for a specific technology type but a commercially provided information technology product relies on cryptographic functionality to enforce its security policy, that the cryptographic module is FIPS-validated or NSA-approved.

### Implementation Guidance

See [NIAP CCEVS](#795aff72-3e6c-4b6b-a80a-b14d84b7f544) for additional information on NIAP. See [NIST CMVP](#1acdc775-aafb-4d11-9341-dc6a822e9d38) for additional information on FIPS-validated cryptographic modules.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SA-4(7) NIAP-approved Protection Profiles  not implemented | Medium | System and Services Acquisition |
| SA-4(7) partially implemented | Low | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-16 | Configuration |


## References

- [NIST SP 800-53 Rev 5 - SA-4(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-4.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IA-7, SC-12, SC-13) reviewed
