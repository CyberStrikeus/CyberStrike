---
name: "AT-2(4)_suspicious-communications-and-anomalous-system-behavior"
description: "Provide literacy training on recognizing suspicious communications and anomalous behavior in organizational systems using [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - at-2-4
  - at
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - AT-2
severity_boost: {}
---

# AT-2(4) Suspicious Communications and Anomalous System Behavior

> **Enhancement of:** AT-2

## High-Level Description

**Family:** Awareness and Training (AT)
**Framework:** NIST SP 800-53 Rev 5

A well-trained workforce provides another organizational control that can be employed as part of a defense-in-depth strategy to protect against malicious code coming into organizations via email or the web applications. Personnel are trained to look for indications of potentially suspicious email (e.g., receiving an unexpected email, receiving an email containing strange or poor grammar, or receiving an email from an unfamiliar sender that appears to be from a known sponsor or contractor). Personnel are also trained on how to respond to suspicious email or web communications. For this process to work effectively, personnel are trained and made aware of what constitutes suspicious communications. Training personnel on how to recognize anomalous behaviors in systems can provide organizations with early warning for the presence of malicious code. Recognition of anomalous behavior by organizational personnel can supplement malicious code detection and protection tools and systems employed by organizations.

## What to Check

- [ ] Verify AT-2(4) Suspicious Communications and Anomalous System Behavior is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for AT-2(4)
- [ ] Verify enhancement builds upon base control AT-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for AT-2(4) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide literacy training on recognizing suspicious communications and anomalous behavior in organizational systems using [organization-defined].

### Implementation Guidance

A well-trained workforce provides another organizational control that can be employed as part of a defense-in-depth strategy to protect against malicious code coming into organizations via email or the web applications. Personnel are trained to look for indications of potentially suspicious email (e.g., receiving an unexpected email, receiving an email containing strange or poor grammar, or receiving an email from an unfamiliar sender that appears to be from a known sponsor or contractor). Personnel are also trained on how to respond to suspicious email or web communications. For this process to work effectively, personnel are trained and made aware of what constitutes suspicious communications. Training personnel on how to recognize anomalous behaviors in systems can provide organizations with early warning for the presence of malicious code. Recognition of anomalous behavior by organizational personnel can supplement malicious code detection and protection tools and systems employed by organizations.

## Risk Assessment

| Finding                                                                         | Severity | Impact                            |
| ------------------------------------------------------------------------------- | -------- | --------------------------------- |
| AT-2(4) Suspicious Communications and Anomalous System Behavior not implemented | Medium   | Awareness and Training            |
| AT-2(4) partially implemented                                                   | Low      | Incomplete Awareness and Training |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - AT-2(4)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=at-2.4)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
