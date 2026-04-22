---
name: "PL-11_baseline-tailoring"
description: "Tailor the selected control baseline by applying specified tailoring actions."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pl-11
  - pl
tech_stack:
  - any
cwe_ids: []
chains_with:
  - PL-10
  - RA-2
  - RA-3
  - RA-9
  - SA-8
prerequisites: []
severity_boost:
  PL-10: "Chain with PL-10 for comprehensive security coverage"
  RA-2: "Chain with RA-2 for comprehensive security coverage"
  RA-3: "Chain with RA-3 for comprehensive security coverage"
---

# PL-11 Baseline Tailoring

## High-Level Description

**Family:** Planning (PL)
**Framework:** NIST SP 800-53 Rev 5

The concept of tailoring allows organizations to specialize or customize a set of baseline controls by applying a defined set of tailoring actions. Tailoring actions facilitate such specialization and customization by allowing organizations to develop security and privacy plans that reflect their specific mission and business functions, the environments where their systems operate, the threats and vulnerabilities that can affect their systems, and any other conditions or situations that can impact their mission or business success. Tailoring guidance is provided in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) . Tailoring a control baseline is accomplished by identifying and designating common controls, applying scoping considerations, selecting compensating controls, assigning values to control parameters, supplementing the control baseline with additional controls as needed, and providing information for control implementation. The general tailoring actions in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) can be supplemented with additional actions based on the needs of organizations. Tailoring actions can be applied to the baselines in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) in accordance with the security and privacy requirements from [FISMA](#0c67b2a9-bede-43d2-b86d-5f35b8be36e9), [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) , and [OMB A-130](#27847491-5ce1-4f6a-a1e4-9e483782f0ef) . Alternatively, other communities of interest adopting different control baselines can apply the tailoring actions in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) to specialize or customize the controls that represent the specific needs and concerns of those entities.

## What to Check

- [ ] Verify PL-11 Baseline Tailoring is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PL-11

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PL-11 implementation details. Verify the organization has documented how this control is satisfied.

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

Tailor the selected control baseline by applying specified tailoring actions.

### Implementation Guidance

The concept of tailoring allows organizations to specialize or customize a set of baseline controls by applying a defined set of tailoring actions. Tailoring actions facilitate such specialization and customization by allowing organizations to develop security and privacy plans that reflect their specific mission and business functions, the environments where their systems operate, the threats and vulnerabilities that can affect their systems, and any other conditions or situations that can impact their mission or business success. Tailoring guidance is provided in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) . Tailoring a control baseline is accomplished by identifying and designating common controls, applying scoping considerations, selecting compensating controls, assigning values to control parameters, supplementing the control baseline with additional controls as needed, and providing information for control implementation. The general tailoring actions in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) can be supplemented with additional actions based on the needs of organizations. Tailoring actions can be applied to the baselines in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) in accordance with the security and privacy requirements from [FISMA](#0c67b2a9-bede-43d2-b86d-5f35b8be36e9), [PRIVACT](#18e71fec-c6fd-475a-925a-5d8495cf8455) , and [OMB A-130](#27847491-5ce1-4f6a-a1e4-9e483782f0ef) . Alternatively, other communities of interest adopting different control baselines can apply the tailoring actions in [SP 800-53B](#46d9e201-840e-440e-987c-2c773333c752) to specialize or customize the controls that represent the specific needs and concerns of those entities.

## Risk Assessment

| Finding                                  | Severity | Impact              |
| ---------------------------------------- | -------- | ------------------- |
| PL-11 Baseline Tailoring not implemented | Medium   | Planning            |
| PL-11 partially implemented              | Low      | Incomplete Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PL-11](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pl-11)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PL-10, RA-2, RA-3, RA-9, SA-8) reviewed
