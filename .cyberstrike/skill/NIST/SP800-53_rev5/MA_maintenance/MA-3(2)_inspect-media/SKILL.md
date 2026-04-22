---
name: "MA-3(2)_inspect-media"
description: "Check media containing diagnostic and test programs for malicious code before the media are used in the system."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ma-3-2
  - ma
  - enhancement
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with:
  - SI-3
prerequisites:
  - MA-3
severity_boost:
  SI-3: "Chain with SI-3 for comprehensive security coverage"
---

# MA-3(2) Inspect Media

> **Enhancement of:** MA-3

## High-Level Description

**Family:** Maintenance (MA)
**Framework:** NIST SP 800-53 Rev 5

If, upon inspection of media containing maintenance, diagnostic, and test programs, organizations determine that the media contains malicious code, the incident is handled consistent with organizational incident handling policies and procedures.

## What to Check

- [ ] Verify MA-3(2) Inspect Media is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MA-3(2)
- [ ] Verify enhancement builds upon base control MA-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MA-3(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Check media containing diagnostic and test programs for malicious code before the media are used in the system.

### Implementation Guidance

If, upon inspection of media containing maintenance, diagnostic, and test programs, organizations determine that the media contains malicious code, the incident is handled consistent with organizational incident handling policies and procedures.

## Risk Assessment

| Finding                               | Severity | Impact                 |
| ------------------------------------- | -------- | ---------------------- |
| MA-3(2) Inspect Media not implemented | Medium   | Maintenance            |
| MA-3(2) partially implemented         | Low      | Incomplete Maintenance |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MA-3(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ma-3.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SI-3) reviewed
