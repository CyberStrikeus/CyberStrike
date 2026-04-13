---
name: cis-azure-foundations-8.1.4.1
description: "Ensure That Microsoft Defender for Containers Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, containers]
cis_id: "8.1.4.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.4.1 Ensure That Microsoft Defender for Containers Is Set To 'On' (Automated)

## Description

Microsoft Defender for Containers helps improve, monitor, and maintain the security of containerized assets--including Kubernetes clusters, nodes, workloads, container registries, and images--across multi-cloud and on-premises environments. By default, when enabling the plan through the Azure Portal, Microsoft Defender for Containers automatically configures: Agentless scanning for machines, Defender sensor for runtime protection, Azure Policy for enforcing security best practices, K8S API access for monitoring and threat detection, and Registry access for vulnerability assessment.

## Rationale

Enabling Microsoft Defender for Containers enhances defense-in-depth by providing advanced threat detection, vulnerability assessment, and security monitoring for containerized environments, leveraging insights from the Microsoft Security Response Center (MSRC).

## Impact

Microsoft Defender for Containers incurs a charge per vCore. Refer to https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/ to estimate potential costs.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Under `Settings`, click `Defender plans`.
5. Under `Cloud Workload Protection (CWP)`, in the row for `Containers`, ensure that the `Status` is set to `On` and `Monitoring coverage` displays `Full`.
6. Repeat steps 1-5 for each subscription.

**From Azure CLI:**
```
az security pricing show --name "Containers" --query [pricingTier,extensions[*].[name,isEnabled]]
```
Ensure that the command returns `Standard`, and that each of the extensions returns `True`.

**From Azure Policy:**
- Policy ID: `1c988dd6-ade4-430f-a608-2a3e5b0a6d38` - Name: 'Microsoft Defender for Containers should be enabled'

## Expected Result

The pricing tier for Containers should be `Standard` with all extensions enabled.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Under `Settings`, click `Defender plans`.
5. Under `Cloud Workload Protection (CWP)`, in the row for `Containers`, click `On` in the `Status` column.
6. If `Monitoring coverage` displays `Partial`, click `Settings` under `Partial`.
7. Set the status of each of the components to `On`.
8. Click `Continue`.
9. Click `Save`.
10. Repeat steps 1-9 for each subscription.

**From Azure CLI:**
```
az security pricing create -n 'Containers' --tier 'standard' --extensions name=ContainerRegistriesVulnerabilityAssessments isEnabled=True --extensions name=AgentlessDiscoveryForKubernetes isEnabled=True --extensions name=AgentlessVmScanning isEnabled=True --extensions name=ContainerSensor isEnabled=True
```

## Default Value

The Microsoft Defender for Containers plan is disabled by default.

## References

1. https://learn.microsoft.com/en-us/cli/azure/security/pricing
2. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing
3. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing
4. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-containers-introduction
5. https://learn.microsoft.com/en-us/azure/defender-for-cloud/tutorial-enable-containers-azure

## Profile

- Level 2
