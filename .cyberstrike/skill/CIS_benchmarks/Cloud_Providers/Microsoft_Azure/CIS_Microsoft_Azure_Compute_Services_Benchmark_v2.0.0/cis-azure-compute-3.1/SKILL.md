---
name: cis-azure-compute-3.1
description: "Ensure Private Virtual Networks are used for Container Instances"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, container-instances, aci]
cis_id: "3.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Private Virtual Networks are used for Container Instances

## Description

Private Virtual Networks (vNets) ensure that services and hosts within the subscription environment are appropriately segmented in private subnets. Public IP addressing for container instances should be handled through a NAT gateway and/or Firewall. In addition to the use of a private vNet for container instances, ensure that a Network Security Group (NSG) is configured and applied to your container instance vNet. The NSG will need to be configured with inbound and outbound TCP/UDP traffic rules which reflect the needs of the services running in your container instance.

## Rationale

Network segmentation reduces threat surface and limits potential lateral movement in the case of breach. Container instances with Public IP addresses present significant threat surface and should be avoided.

## Impact

A well-architected Cloud network will require documentation and consideration for subnetting. The use of vNets and NSGs have a minimal impact on cost, but the use of Firewalls and public-facing gateways will increase that cost.

## Audit Procedure

### Using Azure Portal

1. Go to `Container Instances`.
2. Select a named container instance.
3. Click on `Properties` under the Settings section.
4. Ensure the `IP address` property indicates `(Private)`.
5. Repeat these steps for each named container instance.

### Using Azure CLI

Run the following command:

```bash
az container list
```

For each Container Instance, ensure `"type": "Private"` is indicated under the `"ipAddress"` section.

## Expected Result

All Container Instances should have `"type": "Private"` in the `"ipAddress"` section, indicating they are deployed within a private virtual network.

## Remediation

### Using Azure Portal

Container Instances which have been created with Public IP addresses will need to be re-created with private IP addresses. During the initial creation of a Container Instance, ensure that the Networking Type of "Private" is selected prior to creating the Container Instance.

### Using Azure CLI

Container Instances must be re-created with the appropriate vNet and subnet configuration. Use the `--vnet` and `--subnet` parameters during `az container create` to deploy into a private virtual network.

## Default Value

By default, the "Public" Networking type is selected when creating a Container Instance from Azure Portal.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/container-instances-security-baseline?toc=%2Fazure%2Fcontainer-instances%2FTOC.json
2. https://learn.microsoft.com/en-us/azure/container-instances/container-instances-vnet

## Profile

Level 1 | Manual
