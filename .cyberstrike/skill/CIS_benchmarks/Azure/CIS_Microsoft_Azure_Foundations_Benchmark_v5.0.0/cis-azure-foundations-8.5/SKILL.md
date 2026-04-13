---
name: cis-azure-foundations-8.5
description: "Ensure that Auto provisioning of 'Vulnerability assessment for machines' is Set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, vulnerability-assessment]
cis_id: "8.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.5 Ensure that Auto provisioning of 'Vulnerability assessment for machines' is Set to 'On' (Automated)

## Description

Ensure that the auto provisioning setting for vulnerability assessment for machines is enabled in Microsoft Defender for Cloud, allowing automatic deployment of a vulnerability assessment solution to all supported virtual machines.

## Rationale

Vulnerability assessment is a critical component of any security program. Without automated vulnerability scanning, organizations rely on manual or ad-hoc scanning, which often results in incomplete coverage and delayed identification of vulnerabilities. Enabling auto provisioning ensures that a vulnerability assessment agent is automatically deployed to all supported virtual machines as they are created or discovered, providing consistent and comprehensive vulnerability coverage across the environment. This ensures no machine is missed and vulnerabilities are identified promptly.

## Impact

Enabling auto provisioning deploys a vulnerability assessment agent (Microsoft Defender Vulnerability Management or a qualified third-party solution) to all supported virtual machines. This may consume additional compute resources on each VM. The agent will perform regular vulnerability scans, which may generate network traffic and consume I/O resources during scan windows. Organizations should be aware that scan results will be reported to Microsoft Defender for Cloud.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Settings & monitoring` blade (or `Auto provisioning`).
5. Locate `Vulnerability assessment for machines`.
6. Verify that the toggle is set to `On`.

**From Azure CLI:**

```
az security auto-provisioning-setting list --query "[?name=='default'].{Name:name, AutoProvision:autoProvision}" -o table
```

Check the auto-provisioning settings. Then verify the specific vulnerability assessment configuration:

```
az rest --method get --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/serverVulnerabilityAssessmentsSettings?api-version=2022-01-01-preview"
```

Verify that the vulnerability assessment setting shows auto-provisioning is enabled.

**From PowerShell:**

```
Get-AzSecurityAutoProvisioningSetting | Select-Object Name, AutoProvision
```

Ensure `AutoProvision` is `On`.

Additionally check the vulnerability assessment extension:

```
Get-AzSecuritySetting | Where-Object { $_.Name -like "*vulnerability*" }
```

## Expected Result

Auto provisioning for vulnerability assessment for machines should be set to `On`, and a vulnerability assessment solution should be configured (Microsoft Defender Vulnerability Management recommended).

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Settings & monitoring` blade (or `Auto provisioning`).
5. Set `Vulnerability assessment for machines` to `On`.
6. Select the preferred vulnerability assessment provider (Microsoft Defender Vulnerability Management is recommended).
7. Click `Save`.

**From Azure CLI:**

```
az security auto-provisioning-setting update --name "default" --auto-provision "On"
```

Configure the vulnerability assessment solution:

```
az rest --method put --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/serverVulnerabilityAssessmentsSettings/AzureServersSetting?api-version=2022-01-01-preview" --body '{"properties":{"selectedProvider":"MdeTvm"},"kind":"AzureServersSetting"}'
```

**From PowerShell:**

```
Set-AzSecurityAutoProvisioningSetting -Name "default" -EnableAutoProvision
```

## Default Value

Auto provisioning for vulnerability assessment may not be enabled by default. The default state depends on the Microsoft Defender for Cloud tier and subscription configuration.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/auto-deploy-vulnerability-assessment
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/deploy-vulnerability-assessment-defender-vulnerability-management
3. https://learn.microsoft.com/en-us/azure/defender-for-cloud/enable-data-collection
4. https://learn.microsoft.com/en-us/cli/azure/security/auto-provisioning-setting
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecurityautoprovisioningsetting

## Profile

- Level 2
