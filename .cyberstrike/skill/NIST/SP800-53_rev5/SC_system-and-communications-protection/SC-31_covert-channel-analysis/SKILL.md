---
name: "SC-31_covert-channel-analysis"
description: "Perform a covert channel analysis to identify those aspects of communications within the system that are potential avenues for covert [organization..."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sc-31
  - sc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
  - network
cwe_ids:
  - CWE-311
chains_with:
  - AC-3
  - AC-4
  - SA-8
  - SI-11
prerequisites:
  []
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-4: "Chain with AC-4 for comprehensive security coverage"
  SA-8: "Chain with SA-8 for comprehensive security coverage"
---

# SC-31 Covert Channel Analysis

## High-Level Description

**Family:** System and Communications Protection (SC)
**Framework:** NIST SP 800-53 Rev 5

Developers are in the best position to identify potential areas within systems that might lead to covert channels. Covert channel analysis is a meaningful activity when there is the potential for unauthorized information flows across security domains, such as in the case of systems that contain export-controlled information and have connections to external networks (i.e., networks that are not controlled by organizations). Covert channel analysis is also useful for multilevel secure systems, multiple security level systems, and cross-domain systems.

## What to Check

- [ ] Verify SC-31 Covert Channel Analysis is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SC-31

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SC-31 implementation details. Verify the organization has documented how this control is satisfied.

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
| cloud-audit-mcp | Check encryption and network controls | `cloud_audit_encryption` |
| nmap | Network scanning | `nmap -sV --script ssl-enum-ciphers` |

## Remediation Guide

### Control Statement

Perform a covert channel analysis to identify those aspects of communications within the system that are potential avenues for covert [organization-defined] channels; and
Estimate the maximum bandwidth of those channels.

### Implementation Guidance

Developers are in the best position to identify potential areas within systems that might lead to covert channels. Covert channel analysis is a meaningful activity when there is the potential for unauthorized information flows across security domains, such as in the case of systems that contain export-controlled information and have connections to external networks (i.e., networks that are not controlled by organizations). Covert channel analysis is also useful for multilevel secure systems, multiple security level systems, and cross-domain systems.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SC-31 Covert Channel Analysis not implemented | High | System and Communications Protection |
| SC-31 partially implemented | Medium | Incomplete System and Communications Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-311 | Missing Encryption of Sensitive Data |


## References

- [NIST SP 800-53 Rev 5 - SC-31](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sc-31)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, AC-4, SA-8, SI-11) reviewed
