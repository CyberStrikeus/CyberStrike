---
name: "RA-7_risk-response"
description: "Respond to findings from security and privacy assessments, monitoring, and audits in accordance with organizational risk tolerance."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ra-7
  - ra
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CA-5
  - IR-9
  - PM-4
  - PM-28
  - RA-2
  - RA-3
  - SR-2
prerequisites:
  []
severity_boost:
  CA-5: "Chain with CA-5 for comprehensive security coverage"
  IR-9: "Chain with IR-9 for comprehensive security coverage"
  PM-4: "Chain with PM-4 for comprehensive security coverage"
---

# RA-7 Risk Response

## High-Level Description

**Family:** Risk Assessment (RA)
**Framework:** NIST SP 800-53 Rev 5

Organizations have many options for responding to risk including mitigating risk by implementing new controls or strengthening existing controls, accepting risk with appropriate justification or rationale, sharing or transferring risk, or avoiding risk. The risk tolerance of the organization influences risk response decisions and actions. Risk response addresses the need to determine an appropriate response to risk before generating a plan of action and milestones entry. For example, the response may be to accept risk or reject risk, or it may be possible to mitigate the risk immediately so that a plan of action and milestones entry is not needed. However, if the risk response is to mitigate the risk, and the mitigation cannot be completed immediately, a plan of action and milestones entry is generated.

## What to Check

- [ ] Verify RA-7 Risk Response is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for RA-7

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for RA-7 implementation details. Verify the organization has documented how this control is satisfied.

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

Respond to findings from security and privacy assessments, monitoring, and audits in accordance with organizational risk tolerance.

### Implementation Guidance

Organizations have many options for responding to risk including mitigating risk by implementing new controls or strengthening existing controls, accepting risk with appropriate justification or rationale, sharing or transferring risk, or avoiding risk. The risk tolerance of the organization influences risk response decisions and actions. Risk response addresses the need to determine an appropriate response to risk before generating a plan of action and milestones entry. For example, the response may be to accept risk or reject risk, or it may be possible to mitigate the risk immediately so that a plan of action and milestones entry is not needed. However, if the risk response is to mitigate the risk, and the mitigation cannot be completed immediately, a plan of action and milestones entry is generated.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RA-7 Risk Response not implemented | Medium | Risk Assessment |
| RA-7 partially implemented | Low | Incomplete Risk Assessment |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - RA-7](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ra-7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CA-5, IR-9, PM-4, PM-28, RA-2) reviewed
