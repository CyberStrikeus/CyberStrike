---
name: "T1648_serverless-execution"
description: "Adversaries may abuse serverless computing, integration, and automation services to execute arbitrary code in cloud environments."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1648
  - execution
  - saas
  - iaas
  - office-suite
technique_id: "T1648"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - SaaS
  - IaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1648"
tech_stack:
  - saas
  - cloud
  - office
cwe_ids:
  - CWE-94
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1648 Serverless Execution

## High-Level Description

Adversaries may abuse serverless computing, integration, and automation services to execute arbitrary code in cloud environments. Many cloud providers offer a variety of serverless resources, including compute engines, application integration services, and web servers. 

Adversaries may abuse these resources in various ways as a means of executing arbitrary commands. For example, adversaries may use serverless functions to execute malicious code, such as crypto-mining malware (i.e. Resource Hijacking). Adversaries may also create functions that enable further compromise of the cloud environment. For example, an adversary may use the `IAM:PassRole` permission in AWS or the `iam.serviceAccounts.actAs` permission in Google Cloud to add Additional Cloud Roles to a serverless cloud function, which may then be able to perform actions the original user cannot.

Serverless functions can also be invoked in response to cloud events (i.e. Event Triggered Execution), potentially enabling persistent execution over time. For example, in AWS environments, an adversary may create a Lambda function that automatically adds Additional Cloud Credentials to a user and a corresponding CloudWatch events rule that invokes that function whenever a new user is created. This is also possible in many cloud-based office application suites. For example, in Microsoft 365 environments, an adversary may create a Power Automate workflow that forwards all emails a user receives or creates anonymous sharing links whenever a user is granted access to a document in SharePoint. In Google Workspace environments, they may instead create an Apps Script that exfiltrates a user's data when they open a file.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** SaaS, IaaS, Office Suite

## What to Check

- [ ] Identify if Serverless Execution technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Serverless Execution
- [ ] Check IaaS systems for indicators of Serverless Execution
- [ ] Check Office Suite systems for indicators of Serverless Execution
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Serverless Execution by examining the target platforms (SaaS, IaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1648 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1036 Account Use Policies
Where possible, consider restricting access to and use of serverless functions. For examples, conditional access policies can be applied to users attempting to create workflows in Microsoft Power Automate. Google Apps Scripts that use OAuth can be limited by restricting access to high-risk OAuth scopes.

### M1018 User Account Management
Remove permissions to create, modify, or run serverless resources from users that do not explicitly require them.


## Detection

### Detection Strategy for Serverless Execution (T1648)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Serverless Execution technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Microsoft DART Case Report 001](https://www.microsoft.com/security/blog/2020/03/09/real-life-cybercrime-stories-dart-microsoft-detection-and-response-team)
- [Backdooring an AWS account](https://medium.com/daniel-grzelak/backdooring-an-aws-account-da007d36f8f9)
- [Varonis Power Automate Data Exfiltration](https://www.varonis.com/blog/power-automate-data-exfiltration)
- [Cloud Hack Tricks GWS Apps Script](https://cloud.hacktricks.xyz/pentesting-cloud/workspace-security/gws-google-platforms-phishing/gws-app-scripts)
- [OWN-CERT Google App Script 2024](https://www.own.security/ressources/blog/google-workspace-malicious-app-script-analysis)
- [Cado Security Denonia](https://www.cadosecurity.com/cado-discovers-denonia-the-first-malware-specifically-targeting-lambda/)
- [Rhino Security Labs AWS Privilege Escalation](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/)
- [Rhingo Security Labs GCP Privilege Escalation](https://rhinosecuritylabs.com/gcp/privilege-escalation-google-cloud-platform-part-1/)
- [Atomic Red Team - T1648](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1648)
- [MITRE ATT&CK - T1648](https://attack.mitre.org/techniques/T1648)
