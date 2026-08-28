---
name: "SA-4(3)_development-methods-techniques-and-practices"
description: "Require the developer of the system, system component, or system service to demonstrate the use of a system development life cycle process that includ"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-4-3
  - sa
  - enhancement
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with: []
prerequisites:
  - SA-4
severity_boost: {}
---

# SA-4(3) Development Methods, Techniques, and Practices

> **Enhancement of:** SA-4

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

Following a system development life cycle that includes state-of-the-practice software development methods, systems engineering methods, systems security and privacy engineering methods, and quality control processes helps to reduce the number and severity of latent errors within systems, system components, and system services. Reducing the number and severity of such errors reduces the number of vulnerabilities in those systems, components, and services. Transparency in the methods and techniques that developers select and implement for systems engineering, systems security and privacy engineering, software development, component and system assessments, and quality control processes provides an increased level of assurance in the trustworthiness of the system, system component, or system service being acquired.

## What to Check

- [ ] Verify SA-4(3) Development Methods, Techniques, and Practices is documented in SSP
- [ ] Validate all 3 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-4(3)
- [ ] Verify enhancement builds upon base control SA-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-4(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Require the developer of the system, system component, or system service to demonstrate the use of a system development life cycle process that includes:
[organization-defined];
[organization-defined] ; and
[organization-defined].

### Implementation Guidance

Following a system development life cycle that includes state-of-the-practice software development methods, systems engineering methods, systems security and privacy engineering methods, and quality control processes helps to reduce the number and severity of latent errors within systems, system components, and system services. Reducing the number and severity of such errors reduces the number of vulnerabilities in those systems, components, and services. Transparency in the methods and techniques that developers select and implement for systems engineering, systems security and privacy engineering, software development, component and system assessments, and quality control processes provides an increased level of assurance in the trustworthiness of the system, system component, or system service being acquired.

## Risk Assessment

| Finding                                                                | Severity | Impact                                     |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------ |
| SA-4(3) Development Methods, Techniques, and Practices not implemented | Medium   | System and Services Acquisition            |
| SA-4(3) partially implemented                                          | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-4(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-4.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
