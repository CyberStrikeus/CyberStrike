---
name: cis-azure-foundations-7.4
description: "Ensure HTTP(S) access from the Internet is evaluated and restricted"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.1, cis-azure-foundations-7.2, cis-azure-foundations-7.3, cis-azure-foundations-7.11]
prerequisites: []
severity_boost: {}
---

# Ensure HTTP(S) access from the Internet is evaluated and restricted

## Description

Network security groups should be periodically evaluated for port misconfigurations. Where HTTP(S) is not explicitly required and narrowly configured for resources attached to a network security group, Internet-level access to Azure resources should be restricted or eliminated.

## Rationale

The potential security problem with using HTTP(S) over the Internet is that attackers can use various brute force techniques to gain access to Azure resources. Once the attackers gain access, they can use the resource as a launch point for compromising other resources within the Azure tenant.

## Impact

None documented. Restricting HTTP(S) access from the Internet is a security best practice with no negative functional impact when properly configured.

## Audit Procedure

### Using Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Ensure that no inbound security rule exists that matches the following:
   - Port: `80`, `443`, or range including 80 or 443
   - Protocol: `TCP` or `Any`
   - Source: `0.0.0.0/0`, `Internet`, or `Any`
   - Action: `Allow`
5. Repeat steps 1-4 for each network security group.

### Using Azure Resource Graph

1. Go to `Resource Graph Explorer`.
2. Click `New query`.
3. Paste the following into the query window:

```kql
resources | where type =~ "microsoft.network/networksecuritygroups" | project id, name, securityRule = properties.securityRules | mv-expand securityRule | extend access = securityRule.properties.access, direction = securityRule.properties.direction, protocol = securityRule.properties.protocol, destinationPort = case(isempty(securityRule.properties.destinationPortRange), securityRule.properties.destinationPortRanges, securityRule.properties.destinationPortRange), sourceAddress = case(isempty(securityRule.properties.sourceAddressPrefix), securityRule.properties.sourceAddressPrefixes, securityRule.properties.sourceAddressPrefix) | where access =~ "Allow" and direction =~ "Inbound" and protocol in~ ("tcp", "*") | mv-expand destinationPort | mv-expand sourceAddress | extend destinationPortMin = toint(split(destinationPort, "-")[0]), destinationPortMax = toint(split(destinationPort, "-")[-1]) | where (destinationPortMin <= 80 and destinationPortMax >= 80) or (destinationPortMin <= 443 and destinationPortMax >= 443) or destinationPort == "" | where sourceAddress in~ ("*", "0.0.0.0", "internet", "any") or sourceAddress endswith "/0"
```

4. Click `Run query`.
5. Ensure that no results are returned.

### Using Azure CLI

List network security groups non-default security rules:

```bash
az network nsg list --query [*].[name,securityRules]
```

Ensure that no network security group has an inbound security rule that matches the following:

```json
"access" : "Allow"
"destinationPortRange" : "80", "443", "*", or "<range-including-80-or-443>"
"direction" : "Inbound"
"protocol" : "TCP" or "*"
"sourceAddressPrefix" : "0.0.0.0/0", "Internet", or "*"
```

### Using Azure Policy

- **Policy ID:** 9daedab3-fb2d-461e-b861-71790eead4f6 - **Name:** 'All network ports should be restricted on network security groups associated to your virtual machine'

## Expected Result

No inbound security rules should allow unrestricted HTTP(S) access (ports 80, 443) from the Internet. The Azure Resource Graph query should return zero results.

## Remediation

### Remediate from Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Check the box next to any inbound security rule matching:
   - Port: `80`, `443`, or range including 80 or 443
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

By default, HTTP(S) access from internet is not `enabled`.

## References

1. Express Route: https://learn.microsoft.com/en-us/azure/expressroute/
2. Site-to-Site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/tutorial-site-to-site-portal
3. Point-to-Site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/point-to-site-certificate-gateway
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-1-establish-network-segmentation-boundaries

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 13.4 Perform Traffic Filtering Between Network Segments | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1190 | TA0001 | M1050 |

## Profile

Level 1 | Automated
