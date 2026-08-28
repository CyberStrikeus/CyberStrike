---
name: "PT-6_system-of-records-notice"
description: "For systems that process information that will be maintained in a Privacy Act system of records: Draft system of records notices in accordance with OM"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pt-6
  - pt
tech_stack:
  - any
cwe_ids:
  - CWE-359
chains_with:
  - AC-3
  - PM-20
  - PT-2
  - PT-3
  - PT-5
prerequisites: []
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  PM-20: "Chain with PM-20 for comprehensive security coverage"
  PT-2: "Chain with PT-2 for comprehensive security coverage"
---

# PT-6 System of Records Notice

## High-Level Description

**Family:** Personally Identifiable Information Processing and Transparency (PT)
**Framework:** NIST SP 800-53 Rev 5

The [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) requires that federal agencies publish a system of records notice in the Federal Register upon the establishment and/or modification of a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) system of records. As a general matter, a system of records notice is required when an agency maintains a group of any records under the control of the agency from which information is retrieved by the name of an individual or by some identifying number, symbol, or other identifier. The notice describes the existence and character of the system and identifies the system of records, the purpose(s) of the system, the authority for maintenance of the records, the categories of records maintained in the system, the categories of individuals about whom records are maintained, the routine uses to which the records are subject, and additional details about the system as described in [OMB A-108](#3671ff20-c17c-44d6-8a88-7de203fa74aa).

## What to Check

- [ ] Verify PT-6 System of Records Notice is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PT-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PT-6 implementation details. Verify the organization has documented how this control is satisfied.

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

For systems that process information that will be maintained in a Privacy Act system of records:
Draft system of records notices in accordance with OMB guidance and submit new and significantly modified system of records notices to the OMB and appropriate congressional committees for advance review;
Publish system of records notices in the Federal Register; and
Keep system of records notices accurate, up-to-date, and scoped in accordance with policy.

### Implementation Guidance

The [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) requires that federal agencies publish a system of records notice in the Federal Register upon the establishment and/or modification of a [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) system of records. As a general matter, a system of records notice is required when an agency maintains a group of any records under the control of the agency from which information is retrieved by the name of an individual or by some identifying number, symbol, or other identifier. The notice describes the existence and character of the system and identifies the system of records, the purpose(s) of the system, the authority for maintenance of the records, the categories of records maintained in the system, the categories of individuals about whom records are maintained, the routine uses to which the records are subject, and additional details about the system as described in [OMB A-108](#3671ff20-c17c-44d6-8a88-7de203fa74aa).

## Risk Assessment

| Finding                                       | Severity | Impact                                                                     |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| PT-6 System of Records Notice not implemented | Medium   | Personally Identifiable Information Processing and Transparency            |
| PT-6 partially implemented                    | Low      | Incomplete Personally Identifiable Information Processing and Transparency |

## CWE Categories

| CWE ID  | Title                                    |
| ------- | ---------------------------------------- |
| CWE-359 | Exposure of Private Personal Information |

## References

- [NIST SP 800-53 Rev 5 - PT-6](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pt-6)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, PM-20, PT-2, PT-3, PT-5) reviewed
