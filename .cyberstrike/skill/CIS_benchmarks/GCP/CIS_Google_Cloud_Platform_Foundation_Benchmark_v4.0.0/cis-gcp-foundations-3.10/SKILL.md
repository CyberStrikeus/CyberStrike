---
name: cis-gcp-foundations-3.10
description: "Use Identity Aware Proxy (IAP) to Ensure Only Traffic From Google IP Addresses are Allowed"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, iap, firewall, vpc]
cis_id: "3.10"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.10 Use Identity Aware Proxy (IAP) to Ensure Only Traffic From Google IP Addresses are 'Allowed' (Manual)

## Profile Applicability

- Level 2

## Description

IAP authenticates the user requests to your apps via a Google single sign in. You can then manage these users with permissions to control access. It is recommended to use both IAP permissions and firewalls to restrict this access to your apps with sensitive information.

## Rationale

IAP ensure that access to VMs is controlled by authenticating incoming requests. Access to your apps and the VMs should be restricted by firewall rules that allow only the proxy IAP IP addresses contained in the 35.235.240.0/20 subnet. Otherwise, unauthenticated requests can be made to your apps. To ensure that load balancing works correctly health checks should also be allowed.

## Impact

If firewall rules are not configured correctly, legitimate business services could be negatively impacted. It is recommended to make these changes during a time of low usage.

## Audit

### From Google Cloud Console

1. For each of your apps that have IAP enabled go to the Cloud Console VPC network > Firewall rules.
2. Verify that the only rules correspond to the following values:
   - Targets: All instances in the network
   - Source IP ranges:
     - IAP Proxy Addresses `35.235.240.0/20`
     - Google Health Check `130.211.0.0/22`
     - Google Health Check `35.191.0.0/16`
   - Protocols and ports:
     - Specified protocols and ports required for access and management of your app. For example most health check connection protocols would be covered by:
       - tcp:80 (Default HTTP Health Check port)
       - tcp:443 (Default HTTPS Health Check port)

Note: if you have custom ports used by your load balancers, you will need to list them here.

## Remediation

### From Google Cloud Console

1. Go to the Cloud Console [VPC network > Firewall rules](https://console.cloud.google.com/networking/firewalls/list).
2. Select the checkbox next to the following rules:
   - default-allow-http
   - default-allow-https
   - default-allow-internal
3. Click `Delete`.
4. Click `Create firewall rule` and set the following values:
   - Name: allow-iap-traffic
   - Targets: All instances in the network
   - Source IP ranges (press Enter after you paste each value in the box, copy each full CIDR IP address):
     - IAP Proxy Addresses `35.235.240.0/20`
     - Google Health Check `130.211.0.0/22`
     - Google Health Check `35.191.0.0/16`
   - Protocols and ports:
     - Specified protocols and ports required for access and management of your app. For example most health check connection protocols would be covered by:
       - tcp:80 (Default HTTP Health Check port)
       - tcp:443 (Default HTTPS Health Check port)
       - Note: if you have custom ports used by your load balancers, you will need to list them here
5. When you're finished updating values, click `Create`.

## Default Value

By default all traffic is allowed.

## References

1. https://cloud.google.com/iap/docs/concepts-overview
2. https://cloud.google.com/iap/docs/load-balancer-howto
3. https://cloud.google.com/load-balancing/docs/health-checks
4. https://cloud.google.com/blog/products/identity-security/cloud-iap-enables-context-aware-access-to-vms-via-ssh-and-rdp-without-bastion-hosts
