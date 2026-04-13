---
name: cis-azure-foundations-7.15
description: "Ensure bot protection is enabled in Azure WAF policy on Azure Application Gateway"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, waf, application-gateway]
cis_id: "7.15"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.10, cis-azure-foundations-7.14]
prerequisites: []
severity_boost: {}
---

# Ensure bot protection is enabled in Azure WAF policy on Azure Application Gateway

## Description

Enable bot protection on the Web Application Firewall to block or log requests from known malicious IP addresses identified through the Microsoft Threat Intelligence feed.

## Rationale

Internet traffic from bots can scrape, scan, and search for application vulnerabilities. Enabling bot protection stops requests from known malicious IP addresses and enhances the overall security of your application by reducing exposure to automated attacks.

## Impact

May require monitoring to identify false positives.

## Audit Procedure

### Using Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Web application firewall`.
4. Under `Associated web application firewall policy`, click the policy name.
5. Under `Settings`, click `Managed rules`.
6. Ensure a `Rule Id` containing `Microsoft_BotManagerRuleSet` is listed.
7. Click the `>` to expand the row.
8. Ensure the `Status` for `Malicious Bots` is set to `Enabled`.
9. Repeat steps 1-8 for each application gateway.

### Using Azure CLI

Run the following command to list application gateways:

```bash
az network application-gateway list
```

For each application gateway, run the following command to get the firewall policy id:

```bash
az network application-gateway show --resource-group <resource-group> --name <application-gateway> --query firewallPolicy.id
```

For each firewall policy, run the following command to get the managed rule sets:

```bash
az network application-gateway waf-policy show --ids <firewall-policy> --query managedRules.managedRuleSets
```

Ensure a managed rule set with `ruleSetType` of `Microsoft_BotManagerRuleSet` is returned, and that no `ruleGroupOverrides` for `ruleGroupName` `KnownBadBots` with `state` `Disabled` are returned.

### Using Azure Policy

- **Policy ID:** ebea0d86-7fbd-42e3-8a46-27e7568c2525 - **Name:** 'Bot Protection should be enabled for Azure Application Gateway WAF'

## Expected Result

All WAF policies associated with Application Gateways should have `Microsoft_BotManagerRuleSet` enabled with `Malicious Bots` rule group status set to `Enabled`.

## Remediation

### Remediate from Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Web application firewall`.
4. Under `Associated web application firewall policy`, click the policy name.
5. Under `Settings`, click `Managed rules`.
6. Click `Assign`.
7. Under `Bot Management ruleset`, click to display the drop-down menu.
8. Select a `Microsoft_BotManagerRuleSet`.
9. Click `Save`.
10. Click `X` to close the panel.
11. Repeat steps 1-10 for each application gateway and firewall policy requiring remediation.

### Remediate from Azure CLI

For each firewall policy requiring remediation, run the following command to enable bot protection:

```bash
az network application-gateway waf-policy managed-rule rule-set add --resource-group <resource-group> --policy-name <firewall-policy> --type Microsoft_BotManagerRuleSet --version <0.1|1.0|1.1>
```

## Default Value

Bot protection is disabled by default on Azure Application Gateways with Web Application Firewall.

## References

1. https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/bot-protection-overview
2. https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/bot-protection
3. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway
4. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway/waf-policy
5. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway/waf-policy/managed-rule/rule-set

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
