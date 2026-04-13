---
name: cis-azure-foundations-8.2.1
description: "Ensure That Microsoft Sentinel Is Enabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, sentinel, siem]
cis_id: "8.2.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.1 Ensure That Microsoft Sentinel Is Enabled (Automated)

## Description

Enable Microsoft Sentinel, a cloud-native SIEM (Security Information and Event Management) and SOAR (Security Orchestration, Automation, and Response) solution, to provide intelligent security analytics and threat intelligence across the enterprise.

## Rationale

Microsoft Sentinel provides a centralized platform for collecting, detecting, investigating, and responding to security threats across the entire organization. It collects data from users, devices, applications, and infrastructure, both on-premises and in multiple clouds. Sentinel uses built-in AI and Microsoft's threat intelligence to detect threats, minimize false positives, and automate response through playbooks. Without a SIEM solution like Sentinel, organizations lack comprehensive visibility into security events and the ability to correlate threats across their environment.

## Impact

Enabling Microsoft Sentinel incurs costs based on the volume of data ingested into the Log Analytics workspace. Costs can be significant in environments with high log volumes. Organizations should carefully plan data collection strategies, configure data retention policies, and consider commitment tier pricing to optimize costs. A Log Analytics workspace is required as a prerequisite.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Sentinel`.
2. Verify that at least one workspace is listed with Microsoft Sentinel enabled.
3. Click the workspace to verify it is actively collecting data.

**From Azure CLI:**

```
az sentinel workspace list --query "[].{Name:name, ResourceGroup:resourceGroup}" -o table
```

If no results are returned, Sentinel is not enabled on any workspace.

Alternatively, check if the SecurityInsights solution is installed on a Log Analytics workspace:

```
az monitor log-analytics solution list --resource-group {resourceGroup} --query "[?plan.product=='OMSGallery/SecurityInsights'].{Name:name, Workspace:properties.workspaceResourceId}"
```

**From PowerShell:**

```
Get-AzSentinelOnboardingState -ResourceGroupName {resourceGroup} -WorkspaceName {workspaceName}
```

Ensure the onboarding state indicates Sentinel is enabled.

## Expected Result

At least one Log Analytics workspace should have Microsoft Sentinel enabled and actively collecting security data.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Sentinel`.
2. Click `Create Microsoft Sentinel`.
3. Select an existing Log Analytics workspace or create a new one.
4. Click `Add`.
5. Configure data connectors to begin collecting security logs.

**From Azure CLI:**

```
az sentinel onboarding-state create --resource-group {resourceGroup} --workspace-name {workspaceName} --name "default"
```

**From PowerShell:**

```
New-AzSentinelOnboardingState -ResourceGroupName {resourceGroup} -WorkspaceName {workspaceName} -Name "default"
```

## Default Value

Microsoft Sentinel is not enabled by default. It must be explicitly enabled on a Log Analytics workspace.

## References

1. https://learn.microsoft.com/en-us/azure/sentinel/overview
2. https://learn.microsoft.com/en-us/azure/sentinel/quickstart-onboard
3. https://learn.microsoft.com/en-us/azure/sentinel/connect-data-sources
4. https://azure.microsoft.com/en-us/pricing/details/microsoft-sentinel/
5. https://learn.microsoft.com/en-us/cli/azure/sentinel

## Profile

- Level 2
