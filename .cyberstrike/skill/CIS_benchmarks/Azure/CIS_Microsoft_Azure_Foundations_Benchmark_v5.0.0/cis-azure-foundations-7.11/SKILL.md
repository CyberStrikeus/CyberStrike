---
name: cis-azure-foundations-7.11
description: "Ensure subnets are associated with network security groups"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with:
  [cis-azure-foundations-7.1, cis-azure-foundations-7.2, cis-azure-foundations-7.3, cis-azure-foundations-7.4]
prerequisites: []
severity_boost: {}
---

# Ensure subnets are associated with network security groups

## Description

Protect subnet resources by ensuring subnets are associated with network security groups, which can filter inbound and outbound traffic using security rules.

## Rationale

Unprotected subnets can expose resources to unauthorized access.

## Impact

Minor administrative effort is required to ensure subnets are associated with network security groups. There is no cost to create or use network security groups.

## Audit Procedure

### Using Azure Portal

1. Go to `Virtual networks`.
2. Click the name of a virtual network.
3. Under `Settings`, click `Subnets`.
4. Click the name of a subnet.
5. Under `Security`, ensure `Network security group` is not set to `None`.
6. Repeat steps 1-5 for each virtual network and subnet.

### Using Azure CLI

Run the following command to list virtual networks:

```bash
az network vnet list
```

For each virtual network, run the following command to list subnets:

```bash
az network vnet show --resource-group <resource-group> --name <virtual-network> --query subnets
```

For each subnet, run the following command to get the network security group id:

```bash
az network vnet subnet show --resource-group <resource-group> --vnet-name <virtual-network> --name <subnet> --query networkSecurityGroup.id
```

Ensure a network security group id is returned.

### Using Azure Policy

- **Policy ID:** e71308d3-144b-4262-b144-efdc3cc90517 - **Name:** 'Subnets should be associated with a Network Security Group'

## Expected Result

All subnets should have an associated network security group. The `networkSecurityGroup.id` field should not be null or empty for any subnet.

## Remediation

### Remediate from Azure Portal

1. Go to `Virtual networks`.
2. Click the name of a virtual network.
3. Under `Settings`, click `Subnets`.
4. Click the name of a subnet.
5. Under `Security`, next to `Network security group`, click `None` to display the drop-down menu.
6. Select a network security group.
7. Click `Save`.
8. Repeat steps 1-7 for each virtual network and subnet requiring remediation.

### Remediate from Azure CLI

For each subnet requiring remediation, run the following command to associate it with a network security group:

```bash
az network vnet subnet update --resource-group <resource-group> --vnet-name <virtual-network> --name <subnet> --network-security-group <network-security-group>
```

## Default Value

By default, a subnet is not associated with a network security group.

## References

1. https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview
2. https://learn.microsoft.com/en-us/cli/azure/network/vnet

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments |      | x    | x    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering        | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1190                       | TA0001  | M1030       |

## Profile

Level 1 | Automated
