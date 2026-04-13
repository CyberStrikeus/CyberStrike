---
name: cis-azure-foundations-7.10
description: "Ensure Azure Web Application Firewall (WAF) is enabled on Azure Application Gateway"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, waf, application-gateway]
cis_id: "7.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with:
  [cis-azure-foundations-7.12, cis-azure-foundations-7.13, cis-azure-foundations-7.14, cis-azure-foundations-7.15]
prerequisites: []
severity_boost: {}
---

# Ensure Azure Web Application Firewall (WAF) is enabled on Azure Application Gateway

## Description

Azure Web Application Firewall helps protect applications from common exploits and attacks by inspecting and filtering incoming traffic.

## Rationale

Using Azure Web Application Firewall with Azure Application Gateway reduces exposure to external threats by mitigating attacks on public facing applications.

## Impact

The `WAF V2` tier for Azure Application Gateways costs more than the `Basic` and `Standard V2` tiers. Pricing includes a fixed hourly charge plus a charge per capacity-unit hour. Refer to https://azure.microsoft.com/en-gb/pricing/details/application-gateway/ for details.

## Audit Procedure

### Using Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. In the `Overview`, under `Essentials`, ensure `Tier` is set to `WAF V2`.
4. Repeat steps 1-3 for each application gateway.

### Using Azure CLI

Run the following command to list application gateways:

```bash
az network application-gateway list
```

For each application gateway, run the following command to get the firewall policy id:

```bash
az network application-gateway show --resource-group <resource-group> --name <application-gateway> --query firewallPolicy.id
```

Ensure a firewall policy id is returned.

### Using Azure Policy

- **Policy ID:** 564feb30-bf6a-4854-b4bb-0d2d2d1e6c66 - **Name:** 'Web Application Firewall (WAF) should be enabled for Application Gateway'

## Expected Result

All Application Gateways should have `Tier` set to `WAF V2` and have a firewall policy associated.

## Remediation

**Note:** `Basic` tier application gateways cannot be upgraded to the `WAF V2` tier. Create a new `WAF V2` tier application gateway to replace a `Basic` tier application gateway.

### Remediate from Azure Portal

To remediate a `Standard V2` tier application gateway:

1. Go to `Application gateways`.
2. Click `Add filter`.
3. From the `Filter` drop-down menu, select `SKU size`.
4. Check the box next to `Standard_v2` only.
5. Click `Apply`.
6. Click the name of an application gateway.
7. Under `Settings`, click `Web application firewall`.
8. Under `Configure`, next to `Tier`, click `WAF V2`.
9. Select an existing or create a new `WAF policy`.
10. Click `Save`.
11. Repeat steps 1-10 for each `Standard V2` tier application gateway requiring remediation.

## Default Value

Azure Web Application Firewall is enabled by default for the `WAF V2` tier of Azure Application Gateway. It is not available in the `Basic` tier. Application gateways deployed using the `Standard V2` tier can be upgraded to the `WAF V2` tier to enable Azure Web Application Firewall.

## References

1. https://learn.microsoft.com/en-us/azure/application-gateway/features
2. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway
3. https://azure.microsoft.com/en-us/pricing/details/application-gateway

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.10 Perform Application Layer Filtering            |      |      | x    |
| v7               | 12.9 Deploy Application Layer Filtering Proxy Server |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1190                       | TA0001  | M1030       |

## Profile

Level 2 | Automated
