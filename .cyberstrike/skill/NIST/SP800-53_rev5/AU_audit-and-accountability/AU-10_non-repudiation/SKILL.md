---
name: "AU-10_non-repudiation"
description: "Provide irrefutable evidence that an individual (or process acting on behalf of an individual) has performed [organization-defined]."
category: "information-gathering"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - au-10
  - au
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-778
chains_with:
  - AU-9
  - PM-12
  - SA-8
  - SC-8
  - SC-12
  - SC-13
  - SC-16
  - SC-17
  - SC-23
prerequisites:
  []
severity_boost:
  AU-9: "Chain with AU-9 for comprehensive security coverage"
  PM-12: "Chain with PM-12 for comprehensive security coverage"
  SA-8: "Chain with SA-8 for comprehensive security coverage"
---

# AU-10 Non-repudiation

## High-Level Description

**Family:** Audit and Accountability (AU)
**Framework:** NIST SP 800-53 Rev 5

Types of individual actions covered by non-repudiation include creating information, sending and receiving messages, and approving information. Non-repudiation protects against claims by authors of not having authored certain documents, senders of not having transmitted messages, receivers of not having received messages, and signatories of not having signed documents. Non-repudiation services can be used to determine if information originated from an individual or if an individual took specific actions (e.g., sending an email, signing a contract, approving a procurement request, or receiving specific information). Organizations obtain non-repudiation services by employing various techniques or mechanisms, including digital signatures and digital message receipts.

## What to Check

- [ ] Verify AU-10 Non-repudiation is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AU-10

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AU-10 implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check logging configuration | `cloud_audit_logging` |
| AWS CLI | Review CloudTrail/CloudWatch | `aws cloudtrail describe-trails` |

## Remediation Guide

### Control Statement

Provide irrefutable evidence that an individual (or process acting on behalf of an individual) has performed [organization-defined].

### Implementation Guidance

Types of individual actions covered by non-repudiation include creating information, sending and receiving messages, and approving information. Non-repudiation protects against claims by authors of not having authored certain documents, senders of not having transmitted messages, receivers of not having received messages, and signatories of not having signed documents. Non-repudiation services can be used to determine if information originated from an individual or if an individual took specific actions (e.g., sending an email, signing a contract, approving a procurement request, or receiving specific information). Organizations obtain non-repudiation services by employing various techniques or mechanisms, including digital signatures and digital message receipts.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AU-10 Non-repudiation not implemented | Medium | Audit and Accountability |
| AU-10 partially implemented | Low | Incomplete Audit and Accountability |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-778 | Insufficient Logging |


## References

- [NIST SP 800-53 Rev 5 - AU-10](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=au-10)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AU-9, PM-12, SA-8, SC-8, SC-12) reviewed
