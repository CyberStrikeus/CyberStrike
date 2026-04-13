---
name: cis-gcp-foundations-3.2
description: "Ensure Legacy Networks Do Not Exist for Older Projects"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, vpc]
cis_id: "3.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure Legacy Networks Do Not Exist for Older Projects (Automated)

## Profile Applicability

- Level 1

## Description

In order to prevent use of legacy networks, a project should not have a legacy network configured. As of now, Legacy Networks are gradually being phased out, and you can no longer create projects with them. This recommendation is to check older projects to ensure that they are not using Legacy Networks.

## Rationale

Legacy networks have a single network IPv4 prefix range and a single gateway IP address for the whole network. The network is global in scope and spans all cloud regions. Subnetworks cannot be created in a legacy network and are unable to switch from legacy to auto or custom subnet networks. Legacy networks can have an impact for high network traffic projects and are subject to a single point of contention or failure.

## Impact

None.

## Audit

### From Google Cloud CLI

For each Google Cloud Platform project,

1. Set the project name in the Google Cloud Shell:

```bash
gcloud config set project <Project-ID>
```

2. List the networks configured in that project:

```bash
gcloud compute networks list
```

None of the listed networks should be in the `legacy` mode.

## Remediation

### From Google Cloud CLI

For each Google Cloud Platform project,

1. Follow the documentation and create a non-legacy network suitable for the organization's requirements.
2. Follow the documentation and delete the networks in the `legacy` mode.

## Default Value

By default, networks are not created in the `legacy` mode.

## References

1. https://cloud.google.com/vpc/docs/using-legacy#creating_a_legacy_network
2. https://cloud.google.com/vpc/docs/using-legacy#deleting_a_legacy_network

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | x | x | x |
| v7 | 11.1 Maintain Standard Security Configurations for Network Devices | | x | x |
