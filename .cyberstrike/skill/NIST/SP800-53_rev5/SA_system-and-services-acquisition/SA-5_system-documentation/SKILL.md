---
name: "SA-5_system-documentation"
description: "Obtain or develop administrator documentation for the system, system component, or system service that describes: Secure configuration, installation, "
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - sa-5
  - sa
tech_stack:
  - any
cwe_ids:
  - CWE-16
chains_with:
  - CM-4
  - CM-6
  - CM-7
  - CM-8
  - PL-2
  - PL-4
  - PL-8
  - PS-2
  - SA-3
  - SA-4
prerequisites: []
severity_boost:
  CM-4: "Chain with CM-4 for comprehensive security coverage"
  CM-6: "Chain with CM-6 for comprehensive security coverage"
  CM-7: "Chain with CM-7 for comprehensive security coverage"
---

# SA-5 System Documentation

## High-Level Description

**Family:** System and Services Acquisition (SA)
**Framework:** NIST SP 800-53 Rev 5

System artifacts and documentation created by the developer helps organizational personnel understand the implementation and operation of controls. Organizations consider establishing specific measures to determine the quality and completeness of the content provided. System documentation may be used to delineate roles, responsibilities and expectations of the developer and organization, support the management of supply chain risk, incident response, flaw remediation, and other functions. Personnel or roles that require documentation include system owners, system security officers, and system administrators. Attempts to obtain documentation include contacting manufacturers or suppliers and conducting web-based searches. The inability to obtain documentation may occur due to the age of the system or component or the lack of support from developers and contractors. When documentation cannot be obtained, organizations may need to recreate the documentation if it is essential to the implementation or operation of the controls. The protection provided for the documentation is commensurate with the security category or classification of the system. Documentation that addresses system vulnerabilities may require an increased level of protection. Secure operation of the system includes initially starting the system and resuming secure system operation after a lapse in system operation. An example of least privilege in software development is minimizing the functions that operate with elevated privileges (e.g., limiting the tools and functionality that operate in kernel mode)

## What to Check

- [ ] Verify SA-5 System Documentation is documented in SSP
- [ ] Validate all 8 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for SA-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for SA-5 implementation details. Verify the organization has documented how this control is satisfied.

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

Obtain or develop administrator documentation for the system, system component, or system service that describes:
Secure configuration, installation, and operation of the system, component, or service;
Effective use and maintenance of security and privacy functions and mechanisms; and
Known vulnerabilities regarding configuration and use of administrative or privileged functions;
Obtain or develop user documentation for the system, system component, or system service that describes:
User-accessible security and privacy functions and mechanisms and how to effectively use those functions and mechanisms;
Methods for user interaction, which enables individuals to use the system, component, or service in a more secure manner and protect individual privacy; and
User responsibilities in maintaining the security of the system, component, or service and privacy of individuals;
Document attempts to obtain system, system component, or system service documentation when such documentation is either unavailable or nonexistent and take [organization-defined] in response; and
Distribute documentation to [organization-defined].

### Implementation Guidance

System artifacts and documentation created by the developer helps organizational personnel understand the implementation and operation of controls. Organizations consider establishing specific measures to determine the quality and completeness of the content provided. System documentation may be used to delineate roles, responsibilities and expectations of the developer and organization, support the management of supply chain risk, incident response, flaw remediation, and other functions. Personnel or roles that require documentation include system owners, system security officers, and system administrators. Attempts to obtain documentation include contacting manufacturers or suppliers and conducting web-based searches. The inability to obtain documentation may occur due to the age of the system or component or the lack of support from developers and contractors. When documentation cannot be obtained, organizations may need to recreate the documentation if it is essential to the implementation or operation of the controls. The protection provided for the documentation is commensurate with the security category or classification of the system. Documentation that addresses system vulnerabilities may require an increased level of protection. Secure operation of the system includes initially starting the system and resuming secure system operation after a lapse in system operation. An example of least privilege in software development is minimizing the functions that operate with elevated privileges (e.g., limiting the tools and functionality that operate in kernel mode)

## Risk Assessment

| Finding                                   | Severity | Impact                                     |
| ----------------------------------------- | -------- | ------------------------------------------ |
| SA-5 System Documentation not implemented | Medium   | System and Services Acquisition            |
| SA-5 partially implemented                | Low      | Incomplete System and Services Acquisition |

## CWE Categories

| CWE ID | Title         |
| ------ | ------------- |
| CWE-16 | Configuration |

## References

- [NIST SP 800-53 Rev 5 - SA-5](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=sa-5)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-4, CM-6, CM-7, CM-8, PL-2) reviewed
