---
name: "PL-8(2)_supplier-diversity"
description: "Require that [organization-defined] allocated to [organization-defined] are obtained from different suppliers."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pl-8-2
  - pl
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - SC-29
  - SR-3
prerequisites:
  - PL-8
severity_boost:
  SC-29: "Chain with SC-29 for comprehensive security coverage"
  SR-3: "Chain with SR-3 for comprehensive security coverage"
---

# PL-8(2) Supplier Diversity

> **Enhancement of:** PL-8

## High-Level Description

**Family:** Planning (PL)
**Framework:** NIST SP 800-53 Rev 5

Information technology products have different strengths and weaknesses. Providing a broad spectrum of products complements the individual offerings. For example, vendors offering malicious code protection typically update their products at different times, often developing solutions for known viruses, Trojans, or worms based on their priorities and development schedules. By deploying different products at different locations, there is an increased likelihood that at least one of the products will detect the malicious code. With respect to privacy, vendors may offer products that track personally identifiable information in systems. Products may use different tracking methods. Using multiple products may result in more assurance that personally identifiable information is inventoried.

## What to Check

- [ ] Verify PL-8(2) Supplier Diversity is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PL-8(2)
- [ ] Verify enhancement builds upon base control PL-8

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PL-8(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Require that [organization-defined] allocated to [organization-defined] are obtained from different suppliers.

### Implementation Guidance

Information technology products have different strengths and weaknesses. Providing a broad spectrum of products complements the individual offerings. For example, vendors offering malicious code protection typically update their products at different times, often developing solutions for known viruses, Trojans, or worms based on their priorities and development schedules. By deploying different products at different locations, there is an increased likelihood that at least one of the products will detect the malicious code. With respect to privacy, vendors may offer products that track personally identifiable information in systems. Products may use different tracking methods. Using multiple products may result in more assurance that personally identifiable information is inventoried.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PL-8(2) Supplier Diversity not implemented | Medium | Planning |
| PL-8(2) partially implemented | Low | Incomplete Planning |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PL-8(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pl-8.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SC-29, SR-3) reviewed
