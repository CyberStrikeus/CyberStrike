---
name: "Acquisition Strategies, Tools, and Methods (03.17.02)_acquisition-strategies-tools-and-methods"
description: "Acquisition Strategies, Tools, and Methods"
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - acquisition strategies, tools, and methods (03-17-02)
  - family-03.17
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Acquisition Strategies, Tools, and Methods (03.17.02) Acquisition Strategies, Tools, and Methods

## High-Level Description

**Family:** Supply Chain Risk Management
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Acquisition Strategies, Tools, and Methods

## What to Check

- [ ] Verify Acquisition Strategies, Tools, and Methods (03.17.02) Acquisition Strategies, Tools, and Methods is implemented for CUI systems
- [ ] Review SSP documentation for Acquisition Strategies, Tools, and Methods (03.17.02)
- [ ] Validate CMMC Level 2 assessment objective for Acquisition Strategies, Tools, and Methods (03.17.02)
- [ ] Confirm POA&M addresses any gaps for Acquisition Strategies, Tools, and Methods (03.17.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Acquisition Strategies, Tools, and Methods (03.17.02) implementation description and responsible parties.

### Step 2: Assess Implementation

```
# Verify security controls protecting CUI
# Check access controls, encryption, monitoring as applicable

# For Linux systems:
ls -la /etc/security/ 2>/dev/null
grep -r "CUI\|controlled" /etc/security/ 2>/dev/null

# For cloud:
# Use cloud-audit-mcp tools to assess posture
```

### Step 3: CMMC Assessment Validation

Verify this requirement passes CMMC Level 2 assessment methodology per SP 800-171A Rev 3.

## Tools

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools |
| Manual Review | SSP and POA&M review | Documentation analysis |

## Remediation Guide

### Requirement Statement

Implement Acquisition Strategies, Tools, and Methods per NIST SP 800-171 Rev 3.

### Supplemental Guidance

The acquisition process provides an important vehicle for protecting the supply chain. There are many useful tools and techniques available, including obscuring the end use of a system or system component, using blind purchases, requiring tamperevident packaging, or using trusted or controlled distribution. The results from a supply chain risk assessment can inform the strategies, tools, and methods that are most applicable to the situation. Tools and techniques may provide protections against unauthorized production, theft, tampering, the insertion of counterfeits, the insertion of malicious software or backdoors, and poor development practices throughout the system life cycle. Organizations also consider providing incentives for suppliers to implement safeguards, promote transparency in their processes and security practices, provide contract language that addresses the prohibition of tainted or counterfeit components, and restrict purchases from untrustworthy suppliers. Organizations consider providing training, education, and awareness programs for personnel regarding supply chain risks, available mitigation strategies, and when the programs should be employed. Methods for reviewing and protecting development plans, documentation, and evidence are commensurate with the security requirements of the organization. Contracts may specify documentation protection requirements.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Acquisition Strategies, Tools, and Methods (03.17.02) Acquisition Strategies, Tools, and Methods not implemented | Medium | CUI Protection - Supply Chain Risk Management |
| Acquisition Strategies, Tools, and Methods (03.17.02) partially implemented (POA&M) | Low | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Acquisition Strategies, Tools, and Methods (03.17.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
