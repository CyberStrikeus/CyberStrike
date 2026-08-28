---
name: "SR-5_acquisition-strategies-tools-and-methods"
description: "Employ the following acquisition strategies, contract tools, and procurement methods to protect against, identify, and mitigate supply chain risks: [o"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sr-5
  - sr
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AT-3
  - SA-2
  - SA-3
  - SA-4
  - SA-5
  - SA-8
  - SA-9
  - SA-10
  - SA-15
  - SR-6
prerequisites: []
severity_boost:
  AT-3: "Chain with AT-3 for comprehensive security coverage"
  SA-2: "Chain with SA-2 for comprehensive security coverage"
  SA-3: "Chain with SA-3 for comprehensive security coverage"
---

# SR-5 Acquisition Strategies, Tools, and Methods

## High-Level Description

**Family:** Supply Chain Risk Management (SR)
**Framework:** NIST SP 800-53 Rev 5

The use of the acquisition process provides an important vehicle to protect the supply chain. There are many useful tools and techniques available, including obscuring the end use of a system or system component, using blind or filtered buys, requiring tamper-evident packaging, or using trusted or controlled distribution. The results from a supply chain risk assessment can guide and inform the strategies, tools, and methods that are most applicable to the situation. Tools and techniques may provide protections against unauthorized production, theft, tampering, insertion of counterfeits, insertion of malicious software or backdoors, and poor development practices throughout the system development life cycle. Organizations also consider providing incentives for suppliers who implement controls, promote transparency into their processes and security and privacy practices, provide contract language that addresses the prohibition of tainted or counterfeit components, and restrict purchases from untrustworthy suppliers. Organizations consider providing training, education, and awareness programs for personnel regarding supply chain risk, available mitigation strategies, and when the programs should be employed. Methods for reviewing and protecting development plans, documentation, and evidence are commensurate with the security and privacy requirements of the organization. Contracts may specify documentation protection requirements.

## What to Check

- [ ] Verify SR-5 Acquisition Strategies, Tools, and Methods is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SR-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SR-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Employ the following acquisition strategies, contract tools, and procurement methods to protect against, identify, and mitigate supply chain risks: [organization-defined].

### Implementation Guidance

The use of the acquisition process provides an important vehicle to protect the supply chain. There are many useful tools and techniques available, including obscuring the end use of a system or system component, using blind or filtered buys, requiring tamper-evident packaging, or using trusted or controlled distribution. The results from a supply chain risk assessment can guide and inform the strategies, tools, and methods that are most applicable to the situation. Tools and techniques may provide protections against unauthorized production, theft, tampering, insertion of counterfeits, insertion of malicious software or backdoors, and poor development practices throughout the system development life cycle. Organizations also consider providing incentives for suppliers who implement controls, promote transparency into their processes and security and privacy practices, provide contract language that addresses the prohibition of tainted or counterfeit components, and restrict purchases from untrustworthy suppliers. Organizations consider providing training, education, and awareness programs for personnel regarding supply chain risk, available mitigation strategies, and when the programs should be employed. Methods for reviewing and protecting development plans, documentation, and evidence are commensurate with the security and privacy requirements of the organization. Contracts may specify documentation protection requirements.

## Risk Assessment

| Finding                                                         | Severity | Impact                                  |
| --------------------------------------------------------------- | -------- | --------------------------------------- |
| SR-5 Acquisition Strategies, Tools, and Methods not implemented | Medium   | Supply Chain Risk Management            |
| SR-5 partially implemented                                      | Low      | Incomplete Supply Chain Risk Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - SR-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sr-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AT-3, SA-2, SA-3, SA-4, SA-5) reviewed
