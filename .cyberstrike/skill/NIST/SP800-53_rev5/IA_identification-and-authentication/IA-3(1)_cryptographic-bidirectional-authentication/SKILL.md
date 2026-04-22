---
name: "IA-3(1)_cryptographic-bidirectional-authentication"
description: "Authenticate [organization-defined] before establishing [organization-defined] connection using bidirectional authentication that is cryptographically"
category: "authentication"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ia-3-1
  - ia
  - enhancement
tech_stack:
  - aws
  - azure
  - active-directory
  - linux
  - windows
cwe_ids:
  - CWE-287
chains_with:
  - SC-8
  - SC-12
  - SC-13
prerequisites:
  - IA-3
severity_boost:
  SC-8: "Chain with SC-8 for comprehensive security coverage"
  SC-12: "Chain with SC-12 for comprehensive security coverage"
  SC-13: "Chain with SC-13 for comprehensive security coverage"
---

# IA-3(1) Cryptographic Bidirectional Authentication

> **Enhancement of:** IA-3

## High-Level Description

**Family:** Identification and Authentication (IA)
**Framework:** NIST SP 800-53 Rev 5

A local connection is a connection with a device that communicates without the use of a network. A network connection is a connection with a device that communicates through a network. A remote connection is a connection with a device that communicates through an external network. Bidirectional authentication provides stronger protection to validate the identity of other devices for connections that are of greater risk.

## What to Check

- [ ] Verify IA-3(1) Cryptographic Bidirectional Authentication is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IA-3(1)
- [ ] Verify enhancement builds upon base control IA-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IA-3(1) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool            | Purpose                        | Usage                      |
| --------------- | ------------------------------ | -------------------------- |
| cloud-audit-mcp | Check authentication settings  | `cloud_audit_iam_policies` |
| hackbrowser-mcp | Test authentication mechanisms | `browser_auth_test`        |

## Remediation Guide

### Control Statement

Authenticate [organization-defined] before establishing [organization-defined] connection using bidirectional authentication that is cryptographically based.

### Implementation Guidance

A local connection is a connection with a device that communicates without the use of a network. A network connection is a connection with a device that communicates through a network. A remote connection is a connection with a device that communicates through an external network. Bidirectional authentication provides stronger protection to validate the identity of other devices for connections that are of greater risk.

## Risk Assessment

| Finding                                                            | Severity | Impact                                       |
| ------------------------------------------------------------------ | -------- | -------------------------------------------- |
| IA-3(1) Cryptographic Bidirectional Authentication not implemented | High     | Identification and Authentication            |
| IA-3(1) partially implemented                                      | Medium   | Incomplete Identification and Authentication |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-287 | Improper Authentication |

## References

- [NIST SP 800-53 Rev 5 - IA-3(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ia-3.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (SC-8, SC-12, SC-13) reviewed
