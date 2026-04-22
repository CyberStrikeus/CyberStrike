---
name: "T0859_valid-accounts"
description: "Adversaries may steal the credentials of a specific user or service account using credential access techniques."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0859
  - persistence
  - lateral-movement
technique_id: "T0859"
tactic: "persistence"
all_tactics:
  - persistence
  - lateral-movement
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0859"
tech_stack:
  - ics
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0859 Valid Accounts

## High-Level Description

Adversaries may steal the credentials of a specific user or service account using credential access techniques. In some cases, default credentials for control system devices may be publicly available. Compromised credentials may be used to bypass access controls placed on various resources on hosts and within the network, and may even be used for persistent access to remote systems. Compromised and default credentials may also grant an adversary increased privilege to specific systems and devices or access to restricted areas of the network. Adversaries may choose not to use malware or tools, in conjunction with the legitimate access those credentials provide, to make it harder to detect their presence or to control devices and send legitimate commands in an unintended way.

Adversaries may also create accounts, sometimes using predefined account names and passwords, to provide a means of backup access for persistence.

The overlap of credentials and permissions across a network of systems is of concern because the adversary may be able to pivot across accounts and systems to reach a high level of access (i.e., domain or enterprise administrator) and possibly between the enterprise and operational technology environments. Adversaries may be able to leverage valid credentials from one system to gain access to another system.

## Kill Chain Phase

- Persistence (TA0110)
- Lateral Movement (TA0109)

**Platforms:** ICS

## What to Check

- [ ] Identify if Valid Accounts technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Valid Accounts
- [ ] Verify mitigations are bypassed or absent (10 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Valid Accounts by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0859 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0801 Access Management

Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0926 Privileged Account Management

Audit domain and local accounts and their permission levels routinely to look for situations that could allow an adversary to gain system wide access with stolen privileged account credentials. These audits should also identify if default accounts have been enabled, or if new local accounts are created that have not be authorized. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M0918 User Account Management

Ensure users and user groups have appropriate permissions for their roles through Identity and Access Management (IAM) controls. Implement strict IAM controls to prevent access to systems except for the applications, users, and services that require access. Implement user accounts for each individual for enforcement and non-repudiation of actions.

### M0937 Filter Network Traffic

Consider using IP allowlisting along with user account management to ensure that data access is restricted not only to valid users but only from expected IP ranges to mitigate the use of stolen credentials to access data.

### M0932 Multi-factor Authentication

Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining access to valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

### M0927 Password Policies

Applications and appliances that utilize default username and password should be changed immediately after the installation, and before deployment to a production environment.

### M0913 Application Developer Guidance

Ensure that applications and devices do not store sensitive data or credentials insecurely (e.g., plaintext credentials in code, published credentials in repositories, or credentials in public cloud storage).

### M0947 Audit

Routinely audit source code, application configuration files, open repositories, and public cloud storage for insecure use and storage of credentials.

### M0936 Account Use Policies

Configure features related to account use like login attempt lockouts, specific login times, and password strength requirements as examples. Consider these features as they relate to assets which may impact safety and availability.

### M0915 Active Directory Configuration

Consider configuration and use of a network-wide authentication service such as Active Directory, LDAP, or RADIUS capabilities which can be found in ICS devices.

## Detection

### Detection of Valid Accounts

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| Valid Accounts technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Booz Allen Hamilton](https://www.boozallen.com/content/dam/boozallen/documents/2016/09/ukraine-report-when-the-lights-went-out.pdf)
- [MITRE ATT&CK ICS - T0859](https://attack.mitre.org/techniques/T0859)
