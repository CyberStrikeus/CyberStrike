---
name: "CA-6(1)_joint-authorization-intra-organization"
description: "Employ a joint authorization process for the system that includes multiple authorizing officials from the same organization conducting the authorizati"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ca-6-1
  - ca
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AC-6
prerequisites:
  - CA-6
severity_boost:
  AC-6: "Chain with AC-6 for comprehensive security coverage"
---

# CA-6(1) Joint Authorization — Intra-organization

> **Enhancement of:** CA-6

## High-Level Description

**Family:** Assessment, Authorization, and Monitoring (CA)
**Framework:** NIST SP 800-53 Rev 5

Assigning multiple authorizing officials from the same organization to serve as co-authorizing officials for the system increases the level of independence in the risk-based decision-making process. It also implements the concepts of separation of duties and dual authorization as applied to the system authorization process. The intra-organization joint authorization process is most relevant for connected systems, shared systems, and systems with multiple information owners.

## What to Check

- [ ] Verify CA-6(1) Joint Authorization — Intra-organization is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CA-6(1)
- [ ] Verify enhancement builds upon base control CA-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CA-6(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ a joint authorization process for the system that includes multiple authorizing officials from the same organization conducting the authorization.

### Implementation Guidance

Assigning multiple authorizing officials from the same organization to serve as co-authorizing officials for the system increases the level of independence in the risk-based decision-making process. It also implements the concepts of separation of duties and dual authorization as applied to the system authorization process. The intra-organization joint authorization process is most relevant for connected systems, shared systems, and systems with multiple information owners.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CA-6(1) Joint Authorization — Intra-organization not implemented | Medium | Assessment, Authorization, and Monitoring |
| CA-6(1) partially implemented | Low | Incomplete Assessment, Authorization, and Monitoring |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CA-6(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ca-6.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-6) reviewed
