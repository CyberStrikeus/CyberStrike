---
name: "T1671_cloud-application-integration"
description: "Adversaries may achieve persistence by leveraging OAuth application integrations in a software-as-a-service environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1671
  - persistence
  - office-suite
  - saas
technique_id: "T1671"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1671"
tech_stack:
  - office
  - saas
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1671 Cloud Application Integration

## High-Level Description

Adversaries may achieve persistence by leveraging OAuth application integrations in a software-as-a-service environment. Adversaries may create a custom application, add a legitimate application into the environment, or even co-opt an existing integration to achieve malicious ends.

OAuth is an open standard that allows users to authorize applications to access their information on their behalf. In a SaaS environment such as Microsoft 365 or Google Workspace, users may integrate applications to improve their workflow and achieve tasks.

Leveraging application integrations may allow adversaries to persist in an environment – for example, by granting consent to an application from a high-privileged adversary-controlled account in order to maintain access to its data, even in the event of losing access to the account. In some cases, integrations may remain valid even after the original consenting user account is disabled. Application integrations may also allow adversaries to bypass multi-factor authentication requirements through the use of Application Access Tokens. Finally, they may enable persistent Automated Exfiltration over time.

Creating or adding a new application may require the adversary to create a dedicated Cloud Account for the application and assign it Additional Cloud Roles – for example, in Microsoft 365 environments, an application can only access resources via an associated service principal.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud Application Integration technique is applicable to target environment
- [ ] Check Office Suite systems for indicators of Cloud Application Integration
- [ ] Check SaaS systems for indicators of Cloud Application Integration
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Application Integration by examining the target platforms (Office Suite, SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1671 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Do not allow users to add new application integrations into a SaaS environment. In Entra ID environments, consider enforcing the “Do not allow user consent” option.

### M1047 Audit

Periodically review SaaS integrations for unapproved or potentially malicious applications.

## Detection

### Detection Strategy for Cloud Application Integration

## Risk Assessment

| Finding                                            | Severity | Impact      |
| -------------------------------------------------- | -------- | ----------- |
| Cloud Application Integration technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Wiz Midnight Blizzard 2024](https://www.wiz.io/blog/midnight-blizzard-microsoft-breach-analysis-and-best-practices)
- [Push Security SaaS Persistence 2022](https://pushsecurity.com/blog/maintaining-persistent-access-in-a-saas-first-world/)
- [Push Security Slack Persistence 2023](https://pushsecurity.com/blog/phishing-slack-persistence/)
- [Microsoft Malicious OAuth Applications 2022](https://www.microsoft.com/en-us/security/blog/2022/09/22/malicious-OAuth-applications-used-to-compromise-email-servers-and-spread-spam/)
- [Microsoft Entra ID Service Principals](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals?tabs=browser)
- [SaaS Attacks GitHub Evil Twin Integrations](https://github.com/pushsecurity/saas-attacks/blob/main/techniques/evil_twin_integrations/description.md)
- [Huntress Persistence Microsoft 365 Compromise 2024](https://www.huntress.com/blog/legitimate-apps-as-traitorware-for-persistent-microsoft-365-compromise)
- [Synes Cyber Corner Malicious Azure Application 2023](https://cybercorner.tech/malicious-azure-application-perfectdata-software-and-office365-business-email-compromise/)
- [Atomic Red Team - T1671](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1671)
- [MITRE ATT&CK - T1671](https://attack.mitre.org/techniques/T1671)
