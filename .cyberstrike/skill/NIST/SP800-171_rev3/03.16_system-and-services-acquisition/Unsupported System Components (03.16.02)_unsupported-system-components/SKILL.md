---
name: "Unsupported System Components (03.16.02)_unsupported-system-components"
description: "Replace system components when support for the components is no longer available from the developer, vendor, or manufacturer."
category: "configuration"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - unsupported system components (03-16-02)
  - family-03.16
  - cui-protection
  - cmmc
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Unsupported System Components (03.16.02) Unsupported System Components

## High-Level Description

**Family:** System and Services Acquisition
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Replace system components when support for the components is no longer available from the developer, vendor, or manufacturer.
Provide options for risk mitigation or alternative sources for continued support for unsupported components that cannot be replaced.

## What to Check

- [ ] Verify Unsupported System Components (03.16.02) Unsupported System Components is implemented for CUI systems
- [ ] Review SSP documentation for Unsupported System Components (03.16.02)
- [ ] Validate CMMC Level 2 assessment objective for Unsupported System Components (03.16.02)
- [ ] Confirm POA&M addresses any gaps for Unsupported System Components (03.16.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Unsupported System Components (03.16.02) implementation description and responsible parties.

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

| Tool            | Purpose                      | Usage                  |
| --------------- | ---------------------------- | ---------------------- |
| cloud-audit-mcp | Assess cloud CUI environment | `cloud_audit_*` tools  |
| Manual Review   | SSP and POA&M review         | Documentation analysis |

## Remediation Guide

### Requirement Statement

Replace system components when support for the components is no longer available from the developer, vendor, or manufacturer.
Provide options for risk mitigation or alternative sources for continued support for unsupported components that cannot be replaced.

### Supplemental Guidance

Support for system components includes software patches, firmware updates, replacement parts, and maintenance contracts. An example of unsupported components includes when vendors no longer provide critical software patches or product updates, which can result in opportunities for adversaries to exploit weaknesses or deficiencies in the installed components. Exceptions to replacing unsupported system components include systems that provide critical mission or business capabilities when newer technologies are unavailable or when the systems are so isolated that installing replacement components is not an option. Alternative sources of support address the need to provide continued support for system components that are no longer supported by the original manufacturers, developers, or vendors when such components remain essential to organizational missions and business functions. If necessary, organizations can establish in-house support by developing customized patches for critical software components or obtain the services of external service providers who provide ongoing support for unsupported components through contractual relationships. Such contractual relationships can include open-source software value-added vendors. The increased risk of using unsupported system components can be mitigated by prohibiting the connection of such components to public or uncontrolled networks or implementing other forms of isolation.

## Risk Assessment

| Finding                                                                                | Severity | Impact                                           |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| Unsupported System Components (03.16.02) Unsupported System Components not implemented | Medium   | CUI Protection - System and Services Acquisition |
| Unsupported System Components (03.16.02) partially implemented (POA&M)                 | Low      | CMMC certification risk                          |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Unsupported System Components (03.16.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
