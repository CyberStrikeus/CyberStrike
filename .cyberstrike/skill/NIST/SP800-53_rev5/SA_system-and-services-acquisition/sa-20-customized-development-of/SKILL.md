---
name: "SA-20_customized-development-of-critical-components"
description: "Reimplement or custom develop the following critical system components: [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-20
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CP-2
  - RA-9
  - SA-8
prerequisites: []
severity_boost:
  CP-2: "Chain with CP-2 for comprehensive security coverage"
  RA-9: "Chain with RA-9 for comprehensive security coverage"
  SA-8: "Chain with SA-8 for comprehensive security coverage"
---

# SA-20 Customized Development of Critical Components

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Organizations determine that certain system components likely cannot be trusted due to specific threats to and vulnerabilities in those components for which there are no viable security controls to adequately mitigate risk. Reimplementation or custom development of such components may satisfy requirements for higher assurance and is carried out by initiating changes to system components (including hardware, software, and firmware) such that the standard attacks by adversaries are less likely to succeed. In situations where no alternative sourcing is available and organizations choose not to reimplement or custom develop critical system components, additional controls can be employed. Controls include enhanced auditing, restrictions on source code and system utility access, and protection from deletion of system and application files.

## What to Check

- [ ] Verify SA-20 Customized Development of Critical Components is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-20

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-20 implementation details. Verify the organization has documented how this control is satisfied.

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

Reimplement or custom develop the following critical system components: [organization-defined].

### Implementation Guidance

Organizations determine that certain system components likely cannot be trusted due to specific threats to and vulnerabilities in those components for which there are no viable security controls to adequately mitigate risk. Reimplementation or custom development of such components may satisfy requirements for higher assurance and is carried out by initiating changes to system components (including hardware, software, and firmware) such that the standard attacks by adversaries are less likely to succeed. In situations where no alternative sourcing is available and organizations choose not to reimplement or custom develop critical system components, additional controls can be employed. Controls include enhanced auditing, restrictions on source code and system utility access, and protection from deletion of system and application files.

## Risk Assessment

| Finding                                                             | Severity | Impact                                     |
| ------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-20 Customized Development of Critical Components not implemented | Medium   | System and Services Acquisition            |
| SA-20 partially implemented                                         | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-20](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-20)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-2, RA-9, SA-8) reviewed
