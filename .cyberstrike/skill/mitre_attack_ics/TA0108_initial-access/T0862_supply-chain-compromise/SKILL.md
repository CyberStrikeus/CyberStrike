---
name: "T0862_supply-chain-compromise"
description: "Adversaries may perform supply chain compromise to gain control systems environment access by means of infected products, software, and workflows."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0862
  - initial-access
technique_id: "T0862"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0862"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0862 Supply Chain Compromise

## High-Level Description

Adversaries may perform supply chain compromise to gain control systems environment access by means of infected products, software, and workflows. Supply chain compromise is the manipulation of products, such as devices or software, or their delivery mechanisms before receipt by the end consumer. Adversary compromise of these products and mechanisms is done for the goal of data or system compromise, once infected products are introduced to the target environment. 

Supply chain compromise can occur at all stages of the supply chain, from manipulation of development tools and environments to manipulation of developed products and tools distribution mechanisms. This may involve the compromise and replacement of legitimate software and patches, such as on third party or vendor websites. Targeting of supply chain compromise can be done in attempts to infiltrate the environments of a specific audience. In control systems environments with assets in both the IT and OT networks, it is possible a supply chain compromise affecting the IT environment could enable further access to the OT environment. 

Counterfeit devices may be introduced to the global supply chain posing safety and cyber risks to asset owners and operators. These devices may not meet the safety, engineering and manufacturing requirements of regulatory bodies but may feature tagging indicating conformance with industry standards. Due to the lack of adherence to standards and overall lesser quality, the counterfeit products may pose a serious safety and operational risk. 

Yokogawa identified instances in which their customers received counterfeit differential pressure transmitters using the Yokogawa logo. The counterfeit transmitters were nearly indistinguishable with a semblance of functionality and interface that mimics the genuine product. 

F-Secure Labs analyzed the approach the adversary used to compromise victim systems with Havex. The adversary planted trojanized software installers available on legitimate ICS/SCADA vendor websites. After being downloaded, this software infected the host computer with a Remote Access Trojan (RAT).

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Supply Chain Compromise technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Supply Chain Compromise
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Supply Chain Compromise by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0862 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0951 Update Software
A patch management process should be implemented to check unused dependencies, unmaintained and/or previously vulnerable dependencies, unnecessary features, components, files, and documentation.

### M0947 Audit
Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses. Perform periodic integrity checks of the device to validate the correctness of the firmware, software, programs, and configurations. Integrity checks, which typically include cryptographic hashes or digital signatures, should be compared to those obtained at known valid states, especially after events like device reboots, program downloads, or program restarts.

### M0916 Vulnerability Scanning
Implement continuous monitoring of vulnerability sources. Also, use automatic and manual code review tools.

### M0817 Supply Chain Management
A supply chain management program should include methods the assess the trustworthiness and technical maturity of a supplier, along with technical methods (e.g., code-signing, bill of materials) needed to validate the integrity of newly obtained devices and components. Develop procurement language that emphasizes the expectations for suppliers regarding the artifacts, audit records, and technical capabilities needed to validate the integrity of the devices supply chain.

### M0945 Code Signing
When available utilize hardware and software root-of-trust to verify the authenticity of a system. This may be achieved through cryptographic means, such as digital signatures or hashes, of critical software and firmware throughout the supply chain.


## Detection

### Detection of Supply Chain Compromise


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Supply Chain Compromise technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Control Global May 2019](https://www.controlglobal.com/industrynews/2019/yokogawa-announcement-warns-of-counterfeit-transmitters/)
- [Daavid Hentunen, Antti Tikkanen June 2014](https://www.f-secure.com/weblog/archives/00002718.html)
- [MITRE ATT&CK ICS - T0862](https://attack.mitre.org/techniques/T0862)
