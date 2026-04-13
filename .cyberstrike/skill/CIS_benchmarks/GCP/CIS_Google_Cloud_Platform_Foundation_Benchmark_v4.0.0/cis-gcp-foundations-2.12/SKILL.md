---
name: cis-gcp-foundations-2.12
description: "Ensure That Cloud DNS Logging Is Enabled for All VPC Networks"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, dns, vpc, networking]
cis_id: "2.12"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.12 Ensure That Cloud DNS Logging Is Enabled for All VPC Networks (Automated)

## Profile Applicability

- Level 1

## Description

Cloud DNS logging records the queries from the name servers within your VPC to Stackdriver. Logged queries can come from Compute Engine VMs, GKE containers, or other GCP resources provisioned within the VPC.

## Rationale

Security monitoring and forensics cannot depend solely on IP addresses from VPC flow logs, especially when considering the dynamic IP usage of cloud resources, HTTP virtual host routing, and other technology that can obscure the DNS name used by a client from the IP address. Monitoring of Cloud DNS logs provides visibility to DNS names requested by the clients within the VPC. These logs can be monitored for anomalous domain names, evaluated against threat intelligence, and

Note: For full capture of DNS, firewall must block egress UDP/53 (DNS) and TCP/443 (DNS over HTTPS) to prevent client from using external DNS name server for resolution.

## Impact

Enabling Cloud DNS logging might result in your project being charged for the additional logs usage.

## Audit

### From Google Cloud CLI

1. List all VPCs networks in a project:

```bash
gcloud compute networks list --format="table[box,title='All VPC Networks'](name:label='VPC Network Name')"
```

2. List all DNS policies, logging enablement, and associated VPC networks:

```bash
gcloud dns policies list --flatten="networks[]" --format="table[box,title='All DNS Policies By VPC Network'](name:label='Policy Name',enableLogging:label='Logging Enabled':align=center,networks.networkUrl.basename():label='VPC Network Name')"
```

Each VPC Network should be associated with a DNS policy with logging enabled.

## Remediation

### From Google Cloud CLI

Add New DNS Policy With Logging Enabled

For each VPC network that needs a DNS policy with logging enabled:

```bash
gcloud dns policies create enable-dns-logging --enable-logging --description="Enable DNS Logging" --networks=VPC_NETWORK_NAME
```

The VPC_NETWORK_NAME can be one or more networks in comma-separated list.

Enable Logging for Existing DNS Policy

For each VPC network that has an existing DNS policy that needs logging enabled:

```bash
gcloud dns policies update POLICY_NAME --enable-logging --networks=VPC_NETWORK_NAME
```

The VPC_NETWORK_NAME can be one or more networks in comma-separated list.

## Default Value

Cloud DNS logging is disabled by default on each network.

## References

1. https://cloud.google.com/dns/docs/monitoring

## Additional Information

- Only queries that reach a name server are logged. Cloud DNS resolvers cache responses, queries answered from caches, or direct queries to an external DNS resolver outside the VPC are not logged.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v8 | 8.6 Collect DNS Query Audit Logs | | x | x |
| v8 | 8.11 Conduct Audit Log Reviews | | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |
| v7 | 6.7 Regularly Review Logs | | x | x |
| v7 | 8.7 Enable DNS Query Logging | | x | x |
