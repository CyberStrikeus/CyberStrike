---
name: cis-gcp-foundations-3.3
description: "Ensure That DNSSEC Is Enabled for Cloud DNS"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, dns, dnssec]
cis_id: "3.3"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure That DNSSEC Is Enabled for Cloud DNS (Automated)

## Profile Applicability

- Level 1

## Description

Cloud Domain Name System (DNS) is a fast, reliable and cost-effective domain name system that powers millions of domains on the internet. Domain Name System Security Extensions (DNSSEC) in Cloud DNS enables domain owners to take easy steps to protect their domains against DNS hijacking and man-in-the-middle and other attacks.

## Rationale

Domain Name System Security Extensions (DNSSEC) adds security to the DNS protocol by enabling DNS responses to be validated. Having a trustworthy DNS that translates a domain name like www.example.com into its associated IP address is an increasingly important building block of today's web-based applications. Attackers can hijack this process of domain/IP lookup and redirect users to a malicious site through DNS hijacking and man-in-the-middle attacks. DNSSEC helps mitigate the risk of such attacks by cryptographically signing DNS records. As a result, it prevents attackers from issuing fake DNS responses that may misdirect browsers to nefarious websites.

## Audit

### From Google Cloud Console

1. Go to `Cloud DNS` by visiting https://console.cloud.google.com/net-services/dns/zones.
2. For each zone of `Type Public`, ensure that `DNSSEC` is set to `On`.

### From Google Cloud CLI

1. List all the Managed Zones in a project:

```bash
gcloud dns managed-zones list
```

2. For each zone of `VISIBILITY public`, get its metadata:

```bash
gcloud dns managed-zones describe ZONE_NAME
```

3. Ensure that `dnssecConfig.state` property is `on`.

## Remediation

### From Google Cloud Console

1. Go to `Cloud DNS` by visiting https://console.cloud.google.com/net-services/dns/zones.
2. For each zone of `Type Public`, set `DNSSEC` to `On`.

### From Google Cloud CLI

Use the below command to enable `DNSSEC` for Cloud DNS Zone Name.

```bash
gcloud dns managed-zones update ZONE_NAME --dnssec-state on
```

## Default Value

By default DNSSEC is not enabled.

## References

1. https://cloudplatform.googleblog.com/2017/11/DNSSEC-now-available-in-Cloud-DNS.html
2. https://cloud.google.com/dns/dnssec-config#enabling
3. https://cloud.google.com/dns/dnssec

## CIS Controls

| Controls Version | Control                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | x    | x    | x    |
| v7               | 11.1 Maintain Standard Security Configurations for Network Devices                   |      | x    | x    |
