---
name: "SA-17(2)_security-relevant-components"
description: "Require the developer of the system, system component, or system service to: Define security-relevant hardware, software, and firmware; and Provide a "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-17-2
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - AC-25
  - SA-5
prerequisites:
  - SA-17
severity_boost:
  AC-25: "Chain with AC-25 for comprehensive security coverage"
  SA-5: "Chain with SA-5 for comprehensive security coverage"
---

# SA-17(2) Security-relevant Components

> **Enhancement of:** SA-17

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

The security-relevant hardware, software, and firmware represent the portion of the system, component, or service that is trusted to perform correctly to maintain required security properties.

## What to Check

- [ ] Verify SA-17(2) Security-relevant Components is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-17(2)
- [ ] Verify enhancement builds upon base control SA-17

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-17(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to:
Define security-relevant hardware, software, and firmware; and
Provide a rationale that the definition for security-relevant hardware, software, and firmware is complete.

### Implementation Guidance

The security-relevant hardware, software, and firmware represent the portion of the system, component, or service that is trusted to perform correctly to maintain required security properties.

## Risk Assessment

| Finding                                               | Severity | Impact                                     |
| ----------------------------------------------------- | -------- | ------------------------------------------ |
| SA-17(2) Security-relevant Components not implemented | Medium   | System and Services Acquisition            |
| SA-17(2) partially implemented                        | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-17(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-17.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-25, SA-5) reviewed
