---
name: cis-azure-foundations-7.3
description: "Ensure UDP access from the Internet is evaluated and restricted"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with:
  [cis-azure-foundations-7.1, cis-azure-foundations-7.2, cis-azure-foundations-7.4, cis-azure-foundations-7.11]
prerequisites: []
severity_boost: {}
---

# Ensure UDP access from the Internet is evaluated and restricted

## Description

Network security groups should be periodically evaluated for port misconfigurations. Where UDP is not explicitly required and narrowly configured for resources attached to a network security group, Internet-level access to Azure resources should be restricted or eliminated.

## Rationale

The potential security problem with broadly exposing UDP services over the Internet is that attackers can use DDoS amplification techniques to reflect spoofed UDP traffic from Azure Virtual Machines. The most common types of these attacks exploit exposed DNS, NTP, SSDP, SNMP, CLDAP, and other UDP-based services as amplification sources to disrupt services on other machines within the Azure Virtual Network, or even attack networked devices outside of Azure.

## Impact

None documented. Restricting UDP access from the Internet is a security best practice with no negative functional impact when properly configured.

## Audit Procedure

### Using Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Ensure that no inbound security rule exists that matches the following:
   - Port: `53`, `123`, `161`, `389`, or `1900`, or range including `53`, `123`, `161`, `389`, or `1900`, or other vulnerable UDP-based services
   - Protocol: `UDP` or `Any`
   - Source: `0.0.0.0/0`, `Internet`, or `Any`
   - Action: `Allow`
5. Repeat steps 1-4 for each network security group.

### Using Azure Resource Graph

1. Go to `Resource Graph Explorer`.
2. Click `New query`.
3. Paste the following into the query window:

```kql
resources | where type =~ "microsoft.network/networksecuritygroups" | project id, name, securityRule = properties.securityRules | mv-expand securityRule | extend access = securityRule.properties.access, direction = securityRule.properties.direction, protocol = securityRule.properties.protocol, destinationPort = case(isempty(securityRule.properties.destinationPortRange), securityRule.properties.destinationPortRanges, securityRule.properties.destinationPortRange), sourceAddress = case(isempty(securityRule.properties.sourceAddressPrefix), securityRule.properties.sourceAddressPrefixes, securityRule.properties.sourceAddressPrefix) | where access =~ "Allow" and direction =~ "Inbound" and protocol in~ ("udp", "*") | mv-expand destinationPort | mv-expand sourceAddress | extend destinationPortMin = toint(split(destinationPort, "-")[0]), destinationPortMax = toint(split(destinationPort, "-")[-1]) | where (destinationPortMin <= 53 and destinationPortMax >= 53) or (destinationPortMin <= 123 and destinationPortMax >= 123) or (destinationPortMin <= 161 and destinationPortMax >= 161) or (destinationPortMin <= 389 and destinationPortMax >= 389) or (destinationPortMin <= 1900 and destinationPortMax >= 1900) or destinationPort == "" | where sourceAddress in~ ("*", "0.0.0.0", "internet", "any") or sourceAddress endswith "/0"
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
"destinationPortRange" : "53", "123", "161", "389", "1900", "*" or "<range-including-53-123-161-389-1900-or-other-vulnerable-udp-based-services>"
"direction" : "Inbound"
"protocol" : "UDP" or "*"
"sourceAddressPrefix" : "0.0.0.0/0", "Internet", or "*"
```

### Using Azure Policy

- **Policy ID:** 9daedab3-fb2d-461e-b861-71790eead4f6 - **Name:** 'All network ports should be restricted on network security groups associated to your virtual machine'

## Expected Result

No inbound security rules should allow unrestricted UDP access from the Internet for vulnerable services (DNS/53, NTP/123, SNMP/161, LDAP/389, SSDP/1900). The Azure Resource Graph query should return zero results.

## Remediation

### Remediate from Azure Portal

1. Go to `Network security groups`.
2. Click the name of a network security group.
3. Under `Settings`, click `Inbound security rules`.
4. Check the box next to any inbound security rule matching:
   - Port: Port: `53`, `123`, `161`, `389`, or `1900`, or range including `53`, `123`, `161`, `389`, or `1900`, or other vulnerable UDP-based services
   - Protocol: `UDP` or `Any`
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

By default, UDP access from internet is not `enabled`.

## References

1. https://learn.microsoft.com/en-us/azure/security/fundamentals/network-best-practices#secure-your-critical-azure-service-resources-to-only-your-virtual-networks
2. https://learn.microsoft.com/en-us/azure/ddos-protection/fundamental-best-practices
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-1-establish-network-segmentation-boundaries
4. ExpressRoute: https://learn.microsoft.com/en-us/azure/expressroute/
5. Site-to-site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/tutorial-site-to-site-portal
6. Point-to-site VPN: https://learn.microsoft.com/en-us/azure/vpn-gateway/point-to-site-certificate-gateway

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments            |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1095                       | TA0011  | M1037       |

## Profile

Level 1 | Automated
