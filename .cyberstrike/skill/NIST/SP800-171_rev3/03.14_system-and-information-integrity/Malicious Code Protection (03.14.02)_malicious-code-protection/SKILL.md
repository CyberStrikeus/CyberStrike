---
name: "Malicious Code Protection (03.14.02)_malicious-code-protection"
description: "Implement malicious code protection mechanisms at system entry and exit points to detect and eradicate malicious code."
category: "input-validation"
version: "3.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-171
  - rev3
  - malicious code protection (03-14-02)
  - family-03.14
  - cui-protection
  - cmmc
tech_stack:
  - aws
  - azure
  - gcp
  - linux
  - windows
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# Malicious Code Protection (03.14.02) Malicious Code Protection

## High-Level Description

**Family:** System and Information Integrity
**Framework:** NIST SP 800-171 Rev 3
**Applicability:** Systems processing, storing, or transmitting CUI

Implement malicious code protection mechanisms at system entry and exit points to detect and eradicate malicious code.
Update malicious code protection mechanisms as new releases are available in accordance with configuration management policies and procedures.
Configure malicious code protection mechanisms to:
Perform scans of the system [organization-defined] and real-time scans of files from external sources at endpoints or system entry and exit points as the files are downloaded, opened, or executed; and
Block malicious code, quarantine malicious code, or take other mitigation actions in response to malicious code detection.

## What to Check

- [ ] Verify Malicious Code Protection (03.14.02) Malicious Code Protection is implemented for CUI systems
- [ ] Review SSP documentation for Malicious Code Protection (03.14.02)
- [ ] Validate CMMC Level 2 assessment objective for Malicious Code Protection (03.14.02)
- [ ] Confirm POA&M addresses any gaps for Malicious Code Protection (03.14.02)

## How to Test

### Step 1: Review System Security Plan

Examine the SSP for Malicious Code Protection (03.14.02) implementation description and responsible parties.

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

Implement malicious code protection mechanisms at system entry and exit points to detect and eradicate malicious code.
Update malicious code protection mechanisms as new releases are available in accordance with configuration management policies and procedures.
Configure malicious code protection mechanisms to:
Perform scans of the system [organization-defined] and real-time scans of files from external sources at endpoints or system entry and exit points as the files are downloaded, opened, or executed; and
Block malicious code, quarantine malicious code, or take other mitigation actions in response to malicious code detection.

### Supplemental Guidance

Malicious code insertions occur through the exploitation of system vulnerabilities. Malicious code can be inserted into the system in a variety of ways, including email, the internet, and portable storage devices. Malicious code includes viruses, worms, Trojan horses, and spyware. Malicious code can be encoded in various formats, contained in compressed or hidden files, or hidden in files using techniques such as steganography. Malicious code may be present in commercial off-the-shelf software and custom-built software and could include logic bombs, backdoors, and other types of attacks that could affect organizational mission and business functions. Periodic scans of the system and real-time scans of files from external sources as files are downloaded, opened, or executed can detect malicious code. Malicious code protection mechanisms can also monitor systems for anomalous or unexpected behaviors and take appropriate actions. Malicious code protection mechanisms include signature- and non-signature-based technologies. Non-signature-based detection mechanisms include artificial intelligence techniques that use heuristics to detect, analyze, and describe the characteristics or behavior of malicious code and to provide controls against such code for which signatures do not yet exist or for which existing signatures may not be effective. Malicious code for which active signatures do not yet exist or may be ineffective includes polymorphic malicious code (i.e., code that changes signatures when it replicates). Non-signature-based mechanisms include reputation-based technologies. Pervasive configuration management, anti-exploitation software, and software integrity controls may also be effective in preventing unauthorized code execution. If malicious code cannot be detected by detection methods or technologies, organizations can rely on secure coding practices, configuration management and control, trusted procurement processes, and monitoring practices to help ensure that the software only performs intended functions. Organizations may determine that different actions are warranted in response to the detection of malicious code. For example, organizations can define actions to be taken in response to the detection of malicious code during scans, malicious downloads, or malicious activity when attempting to open or execute files.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Malicious Code Protection (03.14.02) Malicious Code Protection not implemented | High | CUI Protection - System and Information Integrity |
| Malicious Code Protection (03.14.02) partially implemented (POA&M) | Medium | CMMC certification risk |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST SP 800-171 Rev 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)
- [NIST SP 800-171A Rev 3 (Assessment)](https://csrc.nist.gov/pubs/sp/800/171/a/r3/final)
- [CMMC Model Overview](https://www.acq.osd.mil/cmmc/)
- [NIST OSCAL Content](https://github.com/usnistgov/oscal-content)

## Checklist

- [ ] SSP documents Malicious Code Protection (03.14.02) implementation
- [ ] Evidence of operating effectiveness collected
- [ ] POA&M addresses any gaps
- [ ] CMMC assessment objective met
- [ ] Continuous monitoring active
