---
name: "SA-15_development-process-standards-and-tools"
description: "Require the developer of the system, system component, or system service to follow a documented development process that: Explicitly addresses securit"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-15
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - MA-6
  - SA-3
  - SA-4
  - SA-8
  - SA-10
  - SA-11
  - SR-3
  - SR-4
  - SR-5
  - SR-6
prerequisites: []
severity_boost:
  MA-6: "Chain with MA-6 for comprehensive security coverage"
  SA-3: "Chain with SA-3 for comprehensive security coverage"
  SA-4: "Chain with SA-4 for comprehensive security coverage"
---

# SA-15 Development Process, Standards, and Tools

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Development tools include programming languages and computer-aided design systems. Reviews of development processes include the use of maturity models to determine the potential effectiveness of such processes. Maintaining the integrity of changes to tools and processes facilitates effective supply chain risk assessment and mitigation. Such integrity requires configuration control throughout the system development life cycle to track authorized changes and prevent unauthorized changes.

## What to Check

- [ ] Verify SA-15 Development Process, Standards, and Tools is documented in SSP
- [ ] Validate all 5 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-15

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-15 implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to follow a documented development process that:
Explicitly addresses security and privacy requirements;
Identifies the standards and tools used in the development process;
Documents the specific tool options and tool configurations used in the development process; and
Documents, manages, and ensures the integrity of changes to the process and/or tools used in development; and
Review the development process, standards, tools, tool options, and tool configurations [organization-defined] to determine if the process, standards, tools, tool options and tool configurations selected and employed can satisfy the following security and privacy requirements: [organization-defined].

### Implementation Guidance

Development tools include programming languages and computer-aided design systems. Reviews of development processes include the use of maturity models to determine the potential effectiveness of such processes. Maintaining the integrity of changes to tools and processes facilitates effective supply chain risk assessment and mitigation. Such integrity requires configuration control throughout the system development life cycle to track authorized changes and prevent unauthorized changes.

## Risk Assessment

| Finding                                                         | Severity | Impact                                     |
| --------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-15 Development Process, Standards, and Tools not implemented | Medium   | System and Services Acquisition            |
| SA-15 partially implemented                                     | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-15](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-15)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (MA-6, SA-3, SA-4, SA-8, SA-10) reviewed
