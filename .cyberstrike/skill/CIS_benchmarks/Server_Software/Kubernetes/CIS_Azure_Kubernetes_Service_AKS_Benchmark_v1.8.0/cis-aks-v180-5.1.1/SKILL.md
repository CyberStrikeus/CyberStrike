---
name: cis-aks-v180-5.1.1
description: "Ensure Image Vulnerability Scanning using Microsoft Defender for Cloud (MDC) image scanning or a third party provider (Automated)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, acr, image-scanning, vulnerability-scanning, microsoft-defender]
cis_id: "5.1.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1 Ensure Image Vulnerability Scanning using Microsoft Defender for Cloud (MDC) image scanning or a third party provider (Automated)

## Profile Applicability

- Level 1

## Description

Scan images being deployed to Azure (AKS) for vulnerabilities.

Vulnerability scanning for images stored in Microsoft Defender for Cloud (MDC). This capability is powered by Microsoft Defender for Endpoint's MDVM, a leading provider of information security.

When you push an image to Container Registry, MDC automatically scans it, then checks for known vulnerabilities in packages or dependencies defined in the file.

When the scan completes (after about 10 minutes), MDC provides details and a security classification for each vulnerability detected, along with guidance on how to remediate issues and protect vulnerable attack surfaces.

## Rationale

Vulnerabilities in software packages can be exploited by hackers or malicious users to obtain unauthorized access to local cloud resources.

## Impact

When using an MDC, you might occasionally encounter problems. For example, you might not be able to pull a container image because of an issue with Docker in your local environment. Or, a network issue might prevent you from connecting to the registry.

## Audit

Check MDC for Container Registries: This command shows whether container registries is enabled, which includes the image scanning feature. To have image scanning, you must have Defender for Container Registries (or broader Defender for Containers) enabled in your subscription. Often that means the Microsoft.Security/pricings entry for ContainerRegistry is set to "Standard".

```bash
az aks show --resource-group ${RESOURCE_GROUP} --name ${CLUSTER_NAME} --output json --query "sku.tier" -o tsv
```

or

```bash
az security pricing list --query "[type=='Microsoft.ContainerRegistry/registries'].{Name:name, Status:properties.status}" -o table
```

## Remediation

Enable MDC for Container Registries: If you find that container registries is not enabled and you wish to enable it, you can do so using the following command:

```bash
az security pricing create --name ContainerRegistry --tier Standard
```

or

```bash
az resource update --ids /subscriptions/{subscription-id}/resourceGroups/{resource-group-name}/providers/Microsoft.ContainerRegistry/registries/{registry-name} --set properties.enabled=true
```

Replacing subscription-id, resource-group-name and registry-name with the appropriate values.

Please note, enabling MDC for container registries incurs additional costs, so be sure to review the pricing details on the official Azure documentation before enabling it.

## Default Value

Images are not scanned by Default.

## References

1. https://docs.microsoft.com/en-us/azure/security-center/defender-for-container-registries-usage
2. https://docs.microsoft.com/en-us/azure/container-registry/container-registry-check-health
3. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-posture-vulnerability-management#pv-6-perform-software-vulnerability-assessments

## CIS Controls

| Controls Version | Control                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets           |      | x    | x    |
| v8               | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets |      | x    | x    |
| v7               | 3 Continuous Vulnerability Management                                             |      |      |      |
| v7               | 3.1 Run Automated Vulnerability Scanning Tools                                    |      | x    | x    |
| v7               | 3.2 Perform Authenticated Vulnerability Scanning                                  |      | x    | x    |
