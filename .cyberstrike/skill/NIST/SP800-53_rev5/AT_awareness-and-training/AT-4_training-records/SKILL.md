---
name: "AT-4_training-records"
description: "Document and monitor information security and privacy training activities, including security and privacy awareness training and specific role-base..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-4
  - at
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AT-2
  - AT-3
  - CP-3
  - IR-2
  - PM-14
  - SI-12
prerequisites:
  []
severity_boost:
  AT-2: "Chain with AT-2 for comprehensive security coverage"
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  CP-3: "Chain with CP-3 for comprehensive security coverage"
---

# AT-4 Training Records

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

Documentation for specialized training may be maintained by individual supervisors at the discretion of the organization. The National Archives and Records Administration provides guidance on records retention for federal agencies.

## What to Check

- [ ] Verify AT-4 Training Records is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-4 implementation details. Verify the organization has documented how this control is satisfied.

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

Document and monitor information security and privacy training activities, including security and privacy awareness training and specific role-based security and privacy training; and
Retain individual training records for [organization-defined].

### Implementation Guidance

Documentation for specialized training may be maintained by individual supervisors at the discretion of the organization. The National Archives and Records Administration provides guidance on records retention for federal agencies.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AT-4 Training Records not implemented | Medium | Awareness and Training |
| AT-4 partially implemented | Low | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-4](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-2, AT-3, CP-3, IR-2, PM-14) reviewed
