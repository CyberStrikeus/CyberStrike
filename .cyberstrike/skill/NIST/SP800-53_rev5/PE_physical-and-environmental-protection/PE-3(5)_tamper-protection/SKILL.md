---
name: "PE-3(5)_tamper-protection"
description: "Employ [organization-defined] to [organization-defined] physical tampering or alteration of [organization-defined] within the system."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-3-5
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - SA-16
  - SR-9
  - SR-11
prerequisites:
  - PE-3
severity_boost:
  SA-16: "Chain with SA-16 for comprehensive security coverage"
  SR-9: "Chain with SR-9 for comprehensive security coverage"
  SR-11: "Chain with SR-11 for comprehensive security coverage"
---

# PE-3(5) Tamper Protection

> **Enhancement of:** PE-3

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Organizations can implement tamper detection and prevention at selected hardware components or implement tamper detection at some components and tamper prevention at other components. Detection and prevention activities can employ many types of anti-tamper technologies, including tamper-detection seals and anti-tamper coatings. Anti-tamper programs help to detect hardware alterations through counterfeiting and other supply chain-related risks.

## What to Check

- [ ] Verify PE-3(5) Tamper Protection is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-3(5)
- [ ] Verify enhancement builds upon base control PE-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-3(5) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ [organization-defined] to [organization-defined] physical tampering or alteration of [organization-defined] within the system.

### Implementation Guidance

Organizations can implement tamper detection and prevention at selected hardware components or implement tamper detection at some components and tamper prevention at other components. Detection and prevention activities can employ many types of anti-tamper technologies, including tamper-detection seals and anti-tamper coatings. Anti-tamper programs help to detect hardware alterations through counterfeiting and other supply chain-related risks.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-3(5) Tamper Protection not implemented | Medium | Physical and Environmental Protection |
| PE-3(5) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-3(5)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-3.5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SA-16, SR-9, SR-11) reviewed
