---
name: "CP-10(4)_restore-within-time-period"
description: "Provide the capability to restore system components within [organization-defined] from configuration-controlled and integrity-protected information re"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-10-4
  - cp
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids:
  []
chains_with:
  - CM-2
  - CM-6
prerequisites:
  - CP-10
severity_boost:
  CM-2: "Chain with CM-2 for comprehensive security coverage"
  CM-6: "Chain with CM-6 for comprehensive security coverage"
---

# CP-10(4) Restore Within Time Period

> **Enhancement of:** CP-10

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Restoration of system components includes reimaging, which restores the components to known, operational states.

## What to Check

- [ ] Verify CP-10(4) Restore Within Time Period is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-10(4)
- [ ] Verify enhancement builds upon base control CP-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-10(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide the capability to restore system components within [organization-defined] from configuration-controlled and integrity-protected information representing a known, operational state for the components.

### Implementation Guidance

Restoration of system components includes reimaging, which restores the components to known, operational states.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CP-10(4) Restore Within Time Period not implemented | Medium | Contingency Planning |
| CP-10(4) partially implemented | Low | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-10(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-10.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-2, CM-6) reviewed
