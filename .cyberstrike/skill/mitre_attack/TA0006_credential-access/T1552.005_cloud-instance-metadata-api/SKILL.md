---
name: "T1552.005_cloud-instance-metadata-api"
description: "Adversaries may attempt to access the Cloud Instance Metadata API to collect credentials and other sensitive data."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.005
  - credential-access
  - iaas
  - sub-technique
technique_id: "T1552.005"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1552/005"
tech_stack:
  - cloud
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.006
  - T1552.007
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.005 Cloud Instance Metadata API

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may attempt to access the Cloud Instance Metadata API to collect credentials and other sensitive data.

Most cloud service providers support a Cloud Instance Metadata API which is a service provided to running virtual instances that allows applications to access information about the running virtual instance. Available information generally includes name, security group, and additional metadata including sensitive data such as credentials and UserData scripts that may contain additional secrets. The Instance Metadata API is provided as a convenience to assist in managing applications and is accessible by anyone who can access the instance. A cloud metadata API has been used in at least one high profile compromise.

If adversaries have a presence on the running virtual instance, they may query the Instance Metadata API directly to identify credentials that grant access to additional resources. Additionally, adversaries may exploit a Server-Side Request Forgery (SSRF) vulnerability in a public facing web proxy that allows them to gain access to the sensitive information via a request to the Instance Metadata API.

The de facto standard across cloud service providers is to host the Instance Metadata API at <code>http[:]//169.254.169.254</code>.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Cloud Instance Metadata API technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Instance Metadata API
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Instance Metadata API by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1035 Limit Access to Resource Over Network

Limit access to the Instance Metadata API using a host-based firewall such as iptables.

### M1042 Disable or Remove Feature or Program

Disable unnecessary metadata services and restrict or disable insecure versions of metadata services that are in use to prevent adversary access.

### M1037 Filter Network Traffic

Limit access to the Instance Metadata API. A properly configured Web Application Firewall (WAF) may help prevent external adversaries from exploiting Server-side Request Forgery (SSRF) attacks that allow access to the Cloud Instance Metadata API.

## Detection

### Detect Access to Cloud Instance Metadata API (IaaS)

## Risk Assessment

| Finding                                          | Severity | Impact            |
| ------------------------------------------------ | -------- | ----------------- |
| Cloud Instance Metadata API technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [AWS Instance Metadata API](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)
- [RedLock Instance Metadata API 2018](https://redlock.io/blog/instance-metadata-api-a-modern-day-trojan-horse)
- [Krebs Capital One August 2019](https://krebsonsecurity.com/2019/08/what-we-can-learn-from-the-capital-one-hack/)
- [Atomic Red Team - T1552.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.005)
- [MITRE ATT&CK - T1552.005](https://attack.mitre.org/techniques/T1552/005)
