---
name: "PM-25_minimization-of-personally-identifiable-information-used-in-"
description: "Develop, document, and implement policies and procedures that address the use of personally identifiable information for internal testing, training..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-25
  - pm
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - PM-23
  - PT-3
  - SA-3
  - SA-8
  - SI-12
prerequisites:
  []
severity_boost:
  PM-23: "Chain with PM-23 for comprehensive security coverage"
  PT-3: "Chain with PT-3 for comprehensive security coverage"
  SA-3: "Chain with SA-3 for comprehensive security coverage"
---

# PM-25 Minimization of Personally Identifiable Information Used in Testing, Training, and Research

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

The use of personally identifiable information in testing, research, and training increases the risk of unauthorized disclosure or misuse of such information. Organizations consult with the senior agency official for privacy and/or legal counsel to ensure that the use of personally identifiable information in testing, training, and research is compatible with the original purpose for which it was collected. When possible, organizations use placeholder data to avoid exposure of personally identifiable information when conducting testing, training, and research.

## What to Check

- [ ] Verify PM-25 Minimization of Personally Identifiable Information Used in Testing, Training, and Research is documented in SSP
- [ ] Validate all 4 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-25

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-25 implementation details. Verify the organization has documented how this control is satisfied.

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

Develop, document, and implement policies and procedures that address the use of personally identifiable information for internal testing, training, and research;
Limit or minimize the amount of personally identifiable information used for internal testing, training, and research purposes;
Authorize the use of personally identifiable information when such information is required for internal testing, training, and research; and
Review and update policies and procedures [organization-defined].

### Implementation Guidance

The use of personally identifiable information in testing, research, and training increases the risk of unauthorized disclosure or misuse of such information. Organizations consult with the senior agency official for privacy and/or legal counsel to ensure that the use of personally identifiable information in testing, training, and research is compatible with the original purpose for which it was collected. When possible, organizations use placeholder data to avoid exposure of personally identifiable information when conducting testing, training, and research.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PM-25 Minimization of Personally Identifiable Information Used in Testing, Training, and Research not implemented | Medium | Program Management |
| PM-25 partially implemented | Low | Incomplete Program Management |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-25](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-25)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PM-23, PT-3, SA-3, SA-8, SI-12) reviewed
