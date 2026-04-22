---
name: "IR-4(10)_supply-chain-coordination"
description: "Coordinate incident handling activities involving supply chain events with other organizations involved in the supply chain."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ir-4-10
  - ir
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CA-3
  - MA-2
  - SA-9
  - SR-8
prerequisites:
  - IR-4
severity_boost:
  CA-3: "Chain with CA-3 for comprehensive security coverage"
  MA-2: "Chain with MA-2 for comprehensive security coverage"
  SA-9: "Chain with SA-9 for comprehensive security coverage"
---

# IR-4(10) Supply Chain Coordination

> **Enhancement of:** IR-4

## High-Level Description

**Family:** Incident Response (IR)
**Framework:** NIST SP 800-53 Rev 5

Organizations involved in supply chain activities include product developers, system integrators, manufacturers, packagers, assemblers, distributors, vendors, and resellers. Supply chain incidents can occur anywhere through or to the supply chain and include compromises or breaches that involve primary or sub-tier providers, information technology products, system components, development processes or personnel, and distribution processes or warehousing facilities. Organizations consider including processes for protecting and sharing incident information in information exchange agreements and their obligations for reporting incidents to government oversight bodies (e.g., Federal Acquisition Security Council).

## What to Check

- [ ] Verify IR-4(10) Supply Chain Coordination is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IR-4(10)
- [ ] Verify enhancement builds upon base control IR-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IR-4(10) implementation details. Verify the organization has documented how this control is satisfied.

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

Coordinate incident handling activities involving supply chain events with other organizations involved in the supply chain.

### Implementation Guidance

Organizations involved in supply chain activities include product developers, system integrators, manufacturers, packagers, assemblers, distributors, vendors, and resellers. Supply chain incidents can occur anywhere through or to the supply chain and include compromises or breaches that involve primary or sub-tier providers, information technology products, system components, development processes or personnel, and distribution processes or warehousing facilities. Organizations consider including processes for protecting and sharing incident information in information exchange agreements and their obligations for reporting incidents to government oversight bodies (e.g., Federal Acquisition Security Council).

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IR-4(10) Supply Chain Coordination not implemented | Medium | Incident Response |
| IR-4(10) partially implemented | Low | Incomplete Incident Response |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - IR-4(10)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ir-4.10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-3, MA-2, SA-9, SR-8) reviewed
