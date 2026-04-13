---
name: cis-azure-storage-2.2.1.2
description: "Ensure Network Access Rules are set to Deny-by-default"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, networking, private-endpoints, vnet]
cis_id: "2.2.1.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.1.2 Ensure Network Access Rules are set to Deny-by-default (Automated)

## Description

Restricting default network access provides a foundational level of security to networked resources. To limit access to selected networks, the default action must be changed.

## Rationale

Resources using Virtual Network interfaces should be configured to deny-by-default all access from all networks (including internet traffic). Access can be granted to traffic from specific Azure Virtual networks, allowing a secure network boundary for specific applications to be built. If necessary, access can also be granted to public internet IP address ranges to enable connections from specific internet or on-premises clients.

For all traffic inbound from- and outbound to- the internet, a NAT Gateway is recommended at minimum, and ideally all traffic flows through a security gateway device such as a firewall. Security gateway devices will provide an additional level of visibility to inbound and outbound traffic and usually perform advanced monitoring and response activity such as intrusion detection and prevention (IDP), and deep packet inspection (DPI) which help detect activity indicating vulnerabilities and threats.

## Impact

All allowed networks and protocols will need to be allow-listed which creates some administrative overhead.

Implementing a deny-by-default rule may result in a loss of network connectivity. Careful planning and a scheduled implementation window allowing for downtime is highly recommended.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Storage Services > Storage Accounts > Networking > "Ensure Default Network Access Rule for Storage Accounts is Set to Deny"

## Expected Result

The default network access rule for the service should be set to `Deny`, with only explicitly allowed networks and IP ranges having access.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Storage Services > Storage Accounts > Networking > "Ensure Default Network Access Rule for Storage Accounts is Set to Deny"

## Default Value

By default, interfaces attached to virtual networks will accept connections from clients on any network and have a default outbound access rule which allows access to the internet.

The default outbound access rule is scheduled for retirement on September 30th, 2025:
https://azure.microsoft.com/en-us/updates?id=default-outbound-access-for-vms-in-azure-will-be-retired-transition-to-a-new-method-of-internet-access

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-network-security
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Additional Information

This Common Reference Recommendation is referenced in the following Service Recommendations:

- Storage Services > Storage Accounts > Networking > "Ensure Default Network Access Rule for Storage Accounts is Set to Deny"

A NAT gateway is the recommended solution for outbound internet access.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture - Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum.                        |      | x    | x    |
| v7               | 13.3 Monitor and Block Unauthorized Network Traffic - Deploy an automated tool on network perimeters that monitors for unauthorized transfer of sensitive information and blocks such transfers while alerting information security professionals. |      |      | x    |

## Profile

Level 1 | Automated
