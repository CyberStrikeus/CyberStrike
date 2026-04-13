---
name: cis-azure-storage-2.2.2.1
description: "Ensure Private Endpoints are used to access service"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, networking, private-endpoints, vnet]
cis_id: "2.2.2.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.2.1 Ensure Private Endpoints are used to access {service} (Automated)

## Description

Use private endpoints to allow clients and services to securely access data located over a network via an encrypted Private Link. To do this, the private endpoint uses an IP address from the VNet for each service. Network traffic between disparate services securely traverses encrypted over the VNet. This VNet can also link addressing space, extending your network and accessing resources on it. Similarly, it can be a tunnel through public networks to connect remote infrastructures together. This creates further security through segmenting network traffic and preventing outside sources from accessing it.

## Rationale

Securing traffic between services through encryption protects the data from easy interception and reading.

## Impact

A Private Endpoint costs approximately US$7.30 per month. If an Azure Virtual Network is not implemented correctly, this may result in the loss of critical network traffic.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Expected Result

Private Endpoints should be configured and used for accessing the service, with traffic routed through the VNet rather than over the public internet.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Default Value

By default, Private Endpoints are not created for services.

## References

1. https://docs.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview
2. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-portal
3. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-cli?tabs=dynamic-ip
4. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-powershell?tabs=dynamic-ip
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Additional Information

A NAT gateway is the recommended solution for outbound internet access.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture - Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum.                 |      | x    | x    |
| v7               | 14.1 Segment the Network Based on Sensitivity - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). |      | x    | x    |

## Profile

Level 2 | Automated
