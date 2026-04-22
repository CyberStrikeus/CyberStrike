---
name: "SA-17_developer-security-and-privacy-architecture-and-design"
description: "Require the developer of the system, system component, or system service to produce a design specification and security and privacy architecture that:"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-17
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - PL-2
  - PL-8
  - PM-7
  - SA-3
  - SA-4
  - SA-8
  - SC-7
prerequisites: []
severity_boost:
  PL-2: "Chain with PL-2 for comprehensive security coverage"
  PL-8: "Chain with PL-8 for comprehensive security coverage"
  PM-7: "Chain with PM-7 for comprehensive security coverage"
---

# SA-17 Developer Security and Privacy Architecture and Design

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Developer security and privacy architecture and design are directed at external developers, although they could also be applied to internal (in-house) development. In contrast, [PL-8](#pl-8) is directed at internal developers to ensure that organizations develop a security and privacy architecture that is integrated with the enterprise architecture. The distinction between SA-17 and [PL-8](#pl-8) is especially important when organizations outsource the development of systems, system components, or system services and when there is a requirement to demonstrate consistency with the enterprise architecture and security and privacy architecture of the organization. [ISO 15408-2](#87087451-2af5-43d4-88c1-d66ad850f614), [ISO 15408-3](#4452efc0-e79e-47b8-aa30-b54f3ef61c2f) , and [SP 800-160-1](#e3cc0520-a366-4fc9-abc2-5272db7e3564) provide information on security architecture and design, including formal policy models, security-relevant components, formal and informal correspondence, conceptually simple design, and structuring for least privilege and testing.

## What to Check

- [ ] Verify SA-17 Developer Security and Privacy Architecture and Design is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-17

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-17 implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to produce a design specification and security and privacy architecture that:
Is consistent with the organization’s security and privacy architecture that is an integral part the organization’s enterprise architecture;
Accurately and completely describes the required security and privacy functionality, and the allocation of controls among physical and logical components; and
Expresses how individual security and privacy functions, mechanisms, and services work together to provide required security and privacy capabilities and a unified approach to protection.

### Implementation Guidance

Developer security and privacy architecture and design are directed at external developers, although they could also be applied to internal (in-house) development. In contrast, [PL-8](#pl-8) is directed at internal developers to ensure that organizations develop a security and privacy architecture that is integrated with the enterprise architecture. The distinction between SA-17 and [PL-8](#pl-8) is especially important when organizations outsource the development of systems, system components, or system services and when there is a requirement to demonstrate consistency with the enterprise architecture and security and privacy architecture of the organization. [ISO 15408-2](#87087451-2af5-43d4-88c1-d66ad850f614), [ISO 15408-3](#4452efc0-e79e-47b8-aa30-b54f3ef61c2f) , and [SP 800-160-1](#e3cc0520-a366-4fc9-abc2-5272db7e3564) provide information on security architecture and design, including formal policy models, security-relevant components, formal and informal correspondence, conceptually simple design, and structuring for least privilege and testing.

## Risk Assessment

| Finding                                                                      | Severity | Impact                                     |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-17 Developer Security and Privacy Architecture and Design not implemented | Medium   | System and Services Acquisition            |
| SA-17 partially implemented                                                  | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-17](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-17)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PL-2, PL-8, PM-7, SA-3, SA-4) reviewed
