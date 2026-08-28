---
name: "MP-6(1)_review-approve-track-document-and-verify"
description: "Review, approve, track, document, and verify media sanitization and disposal actions."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - mp-6-1
  - mp
  - enhancement
tech_stack:
  - linux
  - windows
cwe_ids: []
chains_with: []
prerequisites:
  - MP-6
severity_boost: {}
---

# MP-6(1) Review, Approve, Track, Document, and Verify

> **Enhancement of:** MP-6

## High-Level Description

**Family:** Media Protection (MP)
**Framework:** NIST SP 800-53 Rev 5

Organizations review and approve media to be sanitized to ensure compliance with records retention policies. Tracking and documenting actions include listing personnel who reviewed and approved sanitization and disposal actions, types of media sanitized, files stored on the media, sanitization methods used, date and time of the sanitization actions, personnel who performed the sanitization, verification actions taken and personnel who performed the verification, and the disposal actions taken. Organizations verify that the sanitization of the media was effective prior to disposal.

## What to Check

- [ ] Verify MP-6(1) Review, Approve, Track, Document, and Verify is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for MP-6(1)
- [ ] Verify enhancement builds upon base control MP-6

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for MP-6(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Review, approve, track, document, and verify media sanitization and disposal actions.

### Implementation Guidance

Organizations review and approve media to be sanitized to ensure compliance with records retention policies. Tracking and documenting actions include listing personnel who reviewed and approved sanitization and disposal actions, types of media sanitized, files stored on the media, sanitization methods used, date and time of the sanitization actions, personnel who performed the sanitization, verification actions taken and personnel who performed the verification, and the disposal actions taken. Organizations verify that the sanitization of the media was effective prior to disposal.

## Risk Assessment

| Finding                                                              | Severity | Impact                      |
| -------------------------------------------------------------------- | -------- | --------------------------- |
| MP-6(1) Review, Approve, Track, Document, and Verify not implemented | Medium   | Media Protection            |
| MP-6(1) partially implemented                                        | Low      | Incomplete Media Protection |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - MP-6(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=mp-6.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
