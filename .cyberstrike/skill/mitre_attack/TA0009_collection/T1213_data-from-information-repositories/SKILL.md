---
name: "T1213_data-from-information-repositories"
description: "Adversaries may leverage information repositories to mine valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213
  - collection
  - linux
  - windows
  - macos
  - saas
  - iaas
  - office-suite
technique_id: "T1213"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - Windows
  - macOS
  - SaaS
  - IaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1213"
tech_stack:
  - linux
  - windows
  - macos
  - saas
  - cloud
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1213.001
  - T1213.002
  - T1213.003
  - T1213.004
  - T1213.005
  - T1213.006
prerequisites: []
severity_boost:
  T1213.001: "Chain with T1213.001 for deeper attack path"
  T1213.002: "Chain with T1213.002 for deeper attack path"
  T1213.003: "Chain with T1213.003 for deeper attack path"
---

# T1213 Data from Information Repositories

## High-Level Description

Adversaries may leverage information repositories to mine valuable information. Information repositories are tools that allow for storage of information, typically to facilitate collaboration or information sharing between users, and can store a wide variety of data that may aid adversaries in further objectives, such as Credential Access, Lateral Movement, or Defense Evasion, or direct access to the target information. Adversaries may also abuse external sharing features to share sensitive documents with recipients outside of the organization (i.e., Transfer Data to Cloud Account).

The following is a brief list of example information that may hold potential value to an adversary and may also be found on an information repository:

- Policies, procedures, and standards
- Physical / logical network diagrams
- System architecture diagrams
- Technical system documentation
- Testing / development credentials (i.e., Unsecured Credentials)
- Work / project schedules
- Source code snippets
- Links to network shares and other internal resources
- Contact or other sensitive information about business partners and customers, including personally identifiable information (PII)

Information stored in a repository may vary based on the specific instance or environment. Specific common information repositories include the following:

- Storage services such as IaaS databases, enterprise databases, and more specialized platforms such as customer relationship management (CRM) databases
- Collaboration platforms such as SharePoint, Confluence, and code repositories
- Messaging platforms such as Slack and Microsoft Teams

In some cases, information repositories have been improperly secured, typically by unintentionally allowing for overly-broad access by all users or even public access to unauthenticated users. This is particularly common with cloud-native or cloud-hosted services, such as AWS Relational Database Service (RDS), Redis, or ElasticSearch.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, Windows, macOS, SaaS, IaaS, Office Suite

## What to Check

- [ ] Identify if Data from Information Repositories technique is applicable to target environment
- [ ] Check Linux systems for indicators of Data from Information Repositories
- [ ] Check Windows systems for indicators of Data from Information Repositories
- [ ] Check macOS systems for indicators of Data from Information Repositories
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Information Repositories by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1213 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Use two or more pieces of evidence to authenticate to a system; such as username and password in addition to a token from a physical smart card or token generator.

### M1060 Out-of-Band Communications Channel

Create plans for leveraging a secure out-of-band communications channel, rather than existing in-network chat applications, in case of a security incident.

### M1017 User Training

Develop and publish policies that define acceptable information to be stored in repositories.

### M1054 Software Configuration

Consider implementing data retention policies to automate periodically archiving and/or deleting data that is no longer needed.

### M1018 User Account Management

Enforce the principle of least-privilege. Consider implementing access control mechanisms that include both authentication and authorization.

### M1047 Audit

Consider periodic review of accounts and privileges for critical and sensitive repositories. Ensure that repositories such as cloud-hosted databases are not unintentionally exposed to the public, and that security groups assigned to them permit only necessary and authorized hosts.

### M1041 Encrypt Sensitive Information

Encrypt data stored at rest in databases.

## Detection

### Abuse of Information Repositories for Data Collection

## Risk Assessment

| Finding                                                 | Severity | Impact     |
| ------------------------------------------------------- | -------- | ---------- |
| Data from Information Repositories technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Mitiga](https://www.mitiga.io/blog/how-mitiga-found-pii-in-exposed-amazon-rds-snapshots)
- [Atlassian Confluence Logging](https://confluence.atlassian.com/confkb/how-to-enable-user-access-logging-182943.html)
- [TrendMicro Exposed Redis 2020](https://www.trendmicro.com/en_us/research/20/d/exposed-redis-instances-abused-for-remote-code-execution-cryptocurrency-mining.html)
- [Microsoft SharePoint Logging](https://support.office.com/en-us/article/configure-audit-settings-for-a-site-collection-a9920c97-38c0-44f2-8bcb-4cf1e2ae22d2)
- [Sharepoint Sharing Events](https://docs.microsoft.com/en-us/microsoft-365/compliance/use-sharing-auditing?view=o365-worldwide#sharepoint-sharing-events)
- [Cybernews Reuters Leak 2022](https://cybernews.com/security/thomson-reuters-leaked-terabytes-sensitive-data/)
- [Atomic Red Team - T1213](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213)
- [MITRE ATT&CK - T1213](https://attack.mitre.org/techniques/T1213)
