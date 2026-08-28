---
name: "SA-10(1)_software-and-firmware-integrity-verification"
description: "Require the developer of the system, system component, or system service to enable integrity verification of software and firmware components."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-10-1
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - SI-7
  - SR-11
prerequisites:
  - SA-10
severity_boost:
  SI-7: "Chain with SI-7 for comprehensive security coverage"
  SR-11: "Chain with SR-11 for comprehensive security coverage"
---

# SA-10(1) Software and Firmware Integrity Verification

> **Enhancement of:** SA-10

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Software and firmware integrity verification allows organizations to detect unauthorized changes to software and firmware components using developer-provided tools, techniques, and mechanisms. The integrity checking mechanisms can also address counterfeiting of software and firmware components. Organizations verify the integrity of software and firmware components, for example, through secure one-way hashes provided by developers. Delivered software and firmware components also include any updates to such components.

## What to Check

- [ ] Verify SA-10(1) Software and Firmware Integrity Verification is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-10(1)
- [ ] Verify enhancement builds upon base control SA-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-10(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to enable integrity verification of software and firmware components.

### Implementation Guidance

Software and firmware integrity verification allows organizations to detect unauthorized changes to software and firmware components using developer-provided tools, techniques, and mechanisms. The integrity checking mechanisms can also address counterfeiting of software and firmware components. Organizations verify the integrity of software and firmware components, for example, through secure one-way hashes provided by developers. Delivered software and firmware components also include any updates to such components.

## Risk Assessment

| Finding                                                               | Severity | Impact                                     |
| --------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-10(1) Software and Firmware Integrity Verification not implemented | Medium   | System and Services Acquisition            |
| SA-10(1) partially implemented                                        | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-10(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-10.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SI-7, SR-11) reviewed
