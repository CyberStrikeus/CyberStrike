---
name: "PE-20_asset-monitoring-and-tracking"
description: "Employ [organization-defined] to track and monitor the location and movement of [organization-defined] within [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-20
  - pe
tech_stack:
  - any
cwe_ids: []
chains_with:
  - CM-8
  - PE-16
  - PM-8
prerequisites: []
severity_boost:
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  PE-16: "Chain with PE-16 for comprehensive security coverage"
  PM-8: "Chain with PM-8 for comprehensive security coverage"
---

# PE-20 Asset Monitoring and Tracking

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Asset location technologies can help ensure that critical assets—including vehicles, equipment, and system components—remain in authorized locations. Organizations consult with the Office of the General Counsel and senior agency official for privacy regarding the deployment and use of asset location technologies to address potential privacy concerns.

## What to Check

- [ ] Verify PE-20 Asset Monitoring and Tracking is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-20

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-20 implementation details. Verify the organization has documented how this control is satisfied.

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

Employ [organization-defined] to track and monitor the location and movement of [organization-defined] within [organization-defined].

### Implementation Guidance

Asset location technologies can help ensure that critical assets—including vehicles, equipment, and system components—remain in authorized locations. Organizations consult with the Office of the General Counsel and senior agency official for privacy regarding the deployment and use of asset location technologies to address potential privacy concerns.

## Risk Assessment

| Finding                                             | Severity | Impact                                           |
| --------------------------------------------------- | -------- | ------------------------------------------------ |
| PE-20 Asset Monitoring and Tracking not implemented | Medium   | Physical and Environmental Protection            |
| PE-20 partially implemented                         | Low      | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-20](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-20)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-8, PE-16, PM-8) reviewed
