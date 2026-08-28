---
name: "SA-9(6)_organization-controlled-cryptographic-keys"
description: "Maintain exclusive control of cryptographic keys for encrypted material stored or transmitted through an external system."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-9-6
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - SC-12
  - SC-13
  - SI-4
prerequisites:
  - SA-9
severity_boost:
  SC-12: "Chain with SC-12 for comprehensive security coverage"
  SC-13: "Chain with SC-13 for comprehensive security coverage"
  SI-4: "Chain with SI-4 for comprehensive security coverage"
---

# SA-9(6) Organization-controlled Cryptographic Keys

> **Enhancement of:** SA-9

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Maintaining exclusive control of cryptographic keys in an external system prevents decryption of organizational data by external system staff. Organizational control of cryptographic keys can be implemented by encrypting and decrypting data inside the organization as data is sent to and received from the external system or by employing a component that permits encryption and decryption functions to be local to the external system but allows exclusive organizational access to the encryption keys.

## What to Check

- [ ] Verify SA-9(6) Organization-controlled Cryptographic Keys is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-9(6)
- [ ] Verify enhancement builds upon base control SA-9

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-9(6) implementation details. Verify the organization has documented how this control is satisfied.

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

Maintain exclusive control of cryptographic keys for encrypted material stored or transmitted through an external system.

### Implementation Guidance

Maintaining exclusive control of cryptographic keys in an external system prevents decryption of organizational data by external system staff. Organizational control of cryptographic keys can be implemented by encrypting and decrypting data inside the organization as data is sent to and received from the external system or by employing a component that permits encryption and decryption functions to be local to the external system but allows exclusive organizational access to the encryption keys.

## Risk Assessment

| Finding                                                            | Severity | Impact                                     |
| ------------------------------------------------------------------ | -------- | ------------------------------------------ |
| SA-9(6) Organization-controlled Cryptographic Keys not implemented | Medium   | System and Services Acquisition            |
| SA-9(6) partially implemented                                      | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-9(6)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-9.6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SC-12, SC-13, SI-4) reviewed
