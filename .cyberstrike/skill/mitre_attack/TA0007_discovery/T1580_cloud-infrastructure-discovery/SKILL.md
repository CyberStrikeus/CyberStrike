---
name: "T1580_cloud-infrastructure-discovery"
description: "An adversary may attempt to discover infrastructure and resources that are available within an infrastructure-as-a-service (IaaS) environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1580
  - discovery
  - iaas
technique_id: "T1580"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1580"
tech_stack:
  - cloud
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1580 Cloud Infrastructure Discovery

## High-Level Description

An adversary may attempt to discover infrastructure and resources that are available within an infrastructure-as-a-service (IaaS) environment. This includes compute service resources such as instances, virtual machines, and snapshots as well as resources of other services including the storage and database services.

Cloud providers offer methods such as APIs and commands issued through CLIs to serve information about infrastructure. For example, AWS provides a <code>DescribeInstances</code> API within the Amazon EC2 API that can return information about one or more instances within an account, the <code>ListBuckets</code> API that returns a list of all buckets owned by the authenticated sender of the request, the <code>HeadBucket</code> API to determine a bucket’s existence along with access permissions of the request sender, or the <code>GetPublicAccessBlock</code> API to retrieve access block configuration for a bucket. Similarly, GCP's Cloud SDK CLI provides the <code>gcloud compute instances list</code> command to list all Google Compute Engine instances in a project , and Azure's CLI command <code>az vm list</code> lists details of virtual machines. In addition to API commands, adversaries can utilize open source tools to discover cloud storage infrastructure through Wordlist Scanning.

An adversary may enumerate resources using a compromised user's access keys to determine which are available to that user. The discovery of these available resources may help adversaries determine their next steps in the Cloud environment, such as establishing Persistence.An adversary may also use this information to change the configuration to make the bucket publicly accessible, allowing data to be accessed without authentication. Adversaries have also may use infrastructure discovery APIs such as <code>DescribeDBInstances</code> to determine size, owner, permissions, and network ACLs of database resources. Adversaries can use this information to determine the potential value of databases and discover the requirements to access them. Unlike in Cloud Service Discovery, this technique focuses on the discovery of components of the provided services rather than the services themselves.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Cloud Infrastructure Discovery technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Infrastructure Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Infrastructure Discovery by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1580 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Limit permissions to discover cloud infrastructure in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.

## Detection

### Detection Strategy for Cloud Infrastructure Discovery

## Risk Assessment

| Finding                                             | Severity | Impact    |
| --------------------------------------------------- | -------- | --------- |
| Cloud Infrastructure Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Expel IO Evil in AWS](https://expel.io/blog/finding-evil-in-aws/)
- [AWS Head Bucket](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html)
- [AWS Get Public Access Block](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetPublicAccessBlock.html)
- [AWS Describe DB Instances](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DescribeDBInstances.html)
- [Amazon Describe Instance](https://docs.aws.amazon.com/cli/latest/reference/ssm/describe-instance-information.html)
- [Amazon Describe Instances API](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html)
- [Google Compute Instances](https://cloud.google.com/sdk/gcloud/reference/compute/instances/list)
- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [Microsoft AZ CLI](https://docs.microsoft.com/en-us/cli/azure/ad/user?view=azure-cli-latest)
- [Malwarebytes OSINT Leaky Buckets - Hioureas](https://blog.malwarebytes.com/researchers-corner/2019/09/hacking-with-aws-incorporating-leaky-buckets-osint-workflow/)
- [Atomic Red Team - T1580](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1580)
- [MITRE ATT&CK - T1580](https://attack.mitre.org/techniques/T1580)
