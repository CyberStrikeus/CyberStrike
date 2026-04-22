---
name: "T0857_system-firmware"
description: "System firmware on modern assets is often designed with an update feature."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0857
  - persistence
  - inhibit-response-function
technique_id: "T0857"
tactic: "persistence"
all_tactics:
  - persistence
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0857"
tech_stack:
  - ics
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0857 System Firmware

## High-Level Description

System firmware on modern assets is often designed with an update feature. Older device firmware may be factory installed and require special reprograming equipment. When available, the firmware update feature enables vendors to remotely patch bugs and perform upgrades. Device firmware updates are often delegated to the user and may be done using a software update package. It may also be possible to perform this task over the network.

An adversary may exploit the firmware update feature on accessible devices to upload malicious or out-of-date firmware. Malicious modification of device firmware may provide an adversary with root access to a device, given firmware is one of the lowest programming abstraction layers.

## Kill Chain Phase

- Persistence (TA0110)
- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if System Firmware technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of System Firmware
- [ ] Verify mitigations are bypassed or absent (13 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to System Firmware by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0857 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0947 Audit

Perform integrity checks of firmware before uploading it on a device. Utilize cryptographic hashes to verify the firmware has not been tampered with by comparing it to a trusted hash of the firmware. This could be from trusted data sources (e.g., vendor site) or through a third-party verification service.

### M0804 Human User Authentication

Devices that allow remote management of firmware should require authentication before allowing any changes. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0802 Communication Authenticity

Protocols used for device management should authenticate all network messages to prevent unauthorized system changes.

### M0945 Code Signing

Devices should verify that firmware has been properly signed by the vendor before allowing installation.

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0808 Encrypt Network Traffic

The encryption of firmware should be considered to prevent adversaries from identifying possible vulnerabilities within the firmware.

### M0801 Access Management

All devices or systems changes, including all administrative functions, should require authentication. Consider using access management technologies to enforce authorization on all management interface access attempts, especially when the device does not inherently provide strong authentication and authorization functions.

### M0946 Boot Integrity

Check the integrity of the existing BIOS or EFI to determine if it is vulnerable to modification. Use Trusted Platform Module technology. Move system's root of trust to hardware to prevent tampering with the SPI flash memory. Technologies such as Intel Boot Guard can assist with this.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0951 Update Software

Patch the BIOS and EFI as necessary.

### M0813 Software Process and Device Authentication

Authenticate connections fromsoftware and devices to prevent unauthorized systems from accessing protected management functions.

### M0941 Encrypt Sensitive Information

The encryption of firmware should be considered to prevent adversaries from identifying possible vulnerabilities within the firmware.

### M0937 Filter Network Traffic

Filter for protocols and payloads associated with firmware activation or updating activity.

## Detection

### Detection of System Firmware

## Risk Assessment

| Finding                              | Severity | Impact      |
| ------------------------------------ | -------- | ----------- |
| System Firmware technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Basnight, Zachry, et al.](http://www.sciencedirect.com/science/article/pii/S1874548213000231)
- [MITRE ATT&CK ICS - T0857](https://attack.mitre.org/techniques/T0857)
