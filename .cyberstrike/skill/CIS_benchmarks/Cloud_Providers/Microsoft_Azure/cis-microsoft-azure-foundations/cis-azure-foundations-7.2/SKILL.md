---
name: cis-azure-foundations-7.2
description: "Ensure SSH access from the Internet is evaluated and restricted"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with:
  [cis-azure-foundations-7.1, cis-azure-foundations-7.3, cis-azure-foundations-7.4, cis-azure-foundations-7.11]
prerequisites: []
severity_boost: {}
---

# Ensure SSH access from the Internet is evaluated and restricted

## Description

Network security groups should be periodically evaluated for port misconfigurations. Where SSH is not explicitly required and narrowly configured for resources attached to a network security group, Internet-level access to Azure resources should be restricted or eliminated.

## Rationale

The potential security problem with using SSH over the Internet is that attackers can use various brute force techniques to gain access to Azure Virtual Machines. Once the attackers gain access, they can use a virtual machine as a launch point for compromising other machines on the Azure Virtual Network or even attack networked devices outside of Azure.

## Impact

None documented. Restricting SSH access from the Internet is a security best practice with no negative functional impact when properly configured with alternative access methods such as VPN, ExpressRoute, or Azure Bastion.

## Audit Procedure

### Using Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Ensure that no inbound security rule exists that matches the following:
   - Port: `22` or range including 22
   - Protocol: `TCP` or `Any`
   - Source: `0.0.0.0/0`, `Internet`, or `Any`
   - Action: `Allow`
5. Repeat steps 1-4 for each network security group.

### Using Azure Resource Graph

1. Go to `Resource Graph Explorer`.
2. Click `New query`.
3. Paste the following into the query window:

```kql
resources | where type =~ "microsoft.network/networksecuritygroups" | project id, name, securityRule = properties.securityRules | mv-expand securityRule | extend access = securityRule.properties.access, direction = securityRule.properties.direction, protocol = securityRule.properties.protocol, destinationPort = case(isempty(securityRule.properties.destinationPortRange), securityRule.properties.destinationPortRanges, securityRule.properties.destinationPortRange), sourceAddress = case(isempty(securityRule.properties.sourceAddressPrefix), securityRule.properties.sourceAddressPrefixes, securityRule.properties.sourceAddressPrefix) | where access =~ "Allow" and direction =~ "Inbound" and protocol in~ ("tcp", "*") | mv-expand destinationPort | mv-expand sourceAddress | extend destinationPortMin = toint(split(destinationPort, "-")[0]), destinationPortMax = toint(split(destinationPort, "-")[-1]) | where (destinationPortMin <= 22 and destinationPortMax >= 22) or destinationPort == "" | where sourceAddress in~ ("*", "0.0.0.0", "internet", "any") or sourceAddress endswith "/0"
```

4. Click `Run query`.
5. Ensure that no results are returned.

### Using Azure CLI

List network security groups with non-default security rules:

```bash
az network nsg list --query [*].[name,securityRules]
```

Ensure that no network security group has an inbound security rule that matches the following:

```json
"access" : "Allow"
"destinationPortRange" : "22", "*", or "<range-including-22>"
"direction" : "Inbound"
"protocol" : "TCP" or "*"
"sourceAddressPrefix" : "0.0.0.0/0", "Internet", or "*"
```

### Using Azure Policy

- **Policy ID:** 22730e10-96f6-4aac-ad84-9383d35b5917 - **Name:** 'Management ports should be closed on your virtual machines'

## Expected Result

No inbound security rules should allow unrestricted SSH access (port 22) from the Internet. The Azure Resource Graph query should return zero results.

## Remediation

### Remediate from Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Check the box next to any inbound security rule matching:
   - Port: `22` or range including 22
   - Protocol: `TCP` or `Any`
   - Source: `0.0.0.0/0`, `Internet`, or `Any`
   - Action: `Allow`
5. Click `Delete`.
6. Click `Yes`.
7. Repeat steps 1-6 for each network security group requiring remediation.

### Remediate from Azure CLI

For each network security group rule requiring remediation, run the following command to delete the rule:

```bash
az network nsg rule delete --resource-group <resource-group> --nsg-name <network-security-group> --name <rule>
```

## Default Value

By default, SSH access from internet is not `enabled`.

## References

1. https://learn.microsoft.com/en-us/azure/security/fundamentals/network-best-practices#disable-rdpssh-access-to-virtual-machines
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-1-establish-network-segmentation-boundaries
3. Express Route: https://learn.microsoft.com/en-us/azure/expressroute/
4. Site-to-Site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/tutorial-site-to-site-portal
5. Point-to-Site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/point-to-site-certificate-gateway

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments            |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1021.004                   | TA0001  | M1035       |

## Profile

Level 1 | Automated
