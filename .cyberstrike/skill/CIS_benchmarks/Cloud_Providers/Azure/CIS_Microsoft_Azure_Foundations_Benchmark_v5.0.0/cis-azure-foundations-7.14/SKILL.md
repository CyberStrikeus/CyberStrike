---
name: cis-azure-foundations-7.14
description: "Ensure request body inspection is enabled in Azure WAF policy on Azure Application Gateway"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, waf, application-gateway]
cis_id: "7.14"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.10, cis-azure-foundations-7.15]
prerequisites: []
severity_boost: {}
---

# Ensure request body inspection is enabled in Azure WAF policy on Azure Application Gateway

## Description

Enable request body inspection so that the Web Application Firewall evaluates the contents of HTTP message bodies for potential threats.

## Rationale

Enabling request body inspection strengthens security by allowing the Web Application Firewall to detect common attacks, such as SQL injection and cross-site scripting.

## Impact

Minor performance impact on the Web Application Firewall. Additional effort may be required to monitor findings.

## Audit Procedure

### Using Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Web application firewall`.
4. Under `Associated web application firewall policy`, click the policy name.
5. Under `Settings`, click `Policy settings`.
6. Ensure the box next to `Enforce request body inspection` is checked.
7. Repeat steps 1-6 for each application gateway.

### Using Azure CLI

Run the following command to list application gateways:

```bash
az network application-gateway list
```

For each application gateway, run the following command to get the firewall policy id:

```bash
az network application-gateway show --resource-group <resource-group> --name <application-gateway> --query firewallPolicy.id
```

For each firewall policy, run the following command to get the request body inspection setting:

```bash
az network application-gateway waf-policy show --ids <firewall-policy> --query policySettings.requestBodyCheck
```

Ensure `true` is returned.

### Using Azure Policy

- **Policy ID:** ca85ef9a-741d-461d-8b7a-18c2da82c666 - **Name:** 'Azure Web Application Firewall on Azure Application Gateway should have request body inspection enabled'

## Expected Result

All WAF policies associated with Application Gateways should have `Enforce request body inspection` enabled (requestBodyCheck = true).

## Remediation

### Remediate from Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Web application firewall`.
4. Under `Associated web application firewall policy`, click the policy name.
5. Under `Settings`, click `Policy settings`.
6. Check the box next to `Enforce request body inspection`.
7. Click `Save`.
8. Repeat steps 1-7 for each application gateway and firewall policy requiring remediation.

### Remediate from Azure CLI

For each firewall policy requiring remediation, run the following command to enable request body inspection:

```bash
az network application-gateway waf-policy update --ids <firewall-policy> --policy-settings request-body-check=true
```

## Default Value

Request body inspection is enabled by default on Azure Application Gateways with Web Application Firewall.

## References

1. https://learn.microsoft.com/en-gb/azure/web-application-firewall/ag/application-gateway-waf-request-size-limits#request-body-inspection
2. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway
3. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway/waf-policy

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
