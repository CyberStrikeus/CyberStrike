---
name: cis-azure-foundations-7.16
description: "Ensure Azure Network Security Perimeter is used to secure Azure PaaS resources"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.16"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Azure Network Security Perimeter is used to secure Azure PaaS resources

## Description

Azure Network Security Perimeter creates a logical boundary around Azure platform-as-a-service (PaaS) resources outside of virtual networks. By default, the network security perimeter denies public access to associated PaaS resources, with the ability to define explicit rules for inbound and outbound traffic.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining appropriate network security perimeter profiles and resource assignments depends on the context and requirements of each organization and environment.

## Rationale

Network security perimeter denies public access to PaaS resources, reducing exposure and mitigating data exfiltration risks.

## Impact

Implementation requires administrative effort to configure and maintain network security perimeter profiles and resource assignments. Azure does not list any additional charges for using network security perimeters.

## Audit Procedure

### Using Azure Portal

1. Go to `Resource groups`.
2. Click the name of a resource group.
3. Take note of PaaS resources.
4. Go to `Network Security Perimeters`.
5. Click the name of a network security perimeter.
6. Under `Settings`, click `Associated resources`.
7. Take note of the associated resources.
8. Repeat steps 1-7 and ensure each PaaS resource is associated with a network security perimeter.

### Using Azure CLI

Run the following command to list resource groups:

```bash
az group list
```

For each resource group, run the following command to list resources:

```bash
az resource list --resource-group <resource-group>
```

Take note of PaaS resources.

For each resource group, run the following command to list network security perimeters:

```bash
az network perimeter list --resource-group <resource-group>
```

For each network security perimeter, run the following command to list resources:

```bash
az network perimeter association list --resource-group <resource-group> --perimeter-name <network-security-perimeter>
```

Ensure each PaaS resource is associated with a network security perimeter.

## Expected Result

All PaaS resources should be associated with a network security perimeter. The association list for each perimeter should include all relevant PaaS resources in the environment.

## Remediation

### Remediate from Azure Portal

Create and associate PaaS resources with a new network security perimeter:

1. Go to `Network Security Perimeters`.
2. Click `+ Create`.
3. Select a `Subscription` and `Resource group`, provide a `Name`, select a `Region`, and provide a `Profile name`.
4. Click `Next`.
5. Click `+ Add`.
6. Check the box next to a PaaS resource to associate it with the network security perimeter.
7. Click `Select`.
8. Click `Next`.
9. Configure appropriate `Inbound access rules` for your organization.
10. Click `Next`.
11. Configure appropriate `Outbound access rules` for your organization.
12. Click `Review + create`.
13. Click `Create`.

Associate PaaS resources with an existing network security perimeter:

1. Go to `Network Security Perimeters`.
2. Click the name of a network security perimeter.
3. Under `Settings`, click `Associated resources`.
4. Click `+ Add`.
5. Select `Associate resources with a new profile` or `Associate resources with an existing profile`.
6. To associate resources with a new profile:
   1. Provide a `Name`.
   2. Click `Next`.
   3. Click `+ Add`.
   4. Check the box next to a PaaS resource to associate it with the network security perimeter.
   5. Click `Select`.
   6. Click `Next`.
   7. Configure appropriate `Inbound access rules` for your organization.
   8. Click `Next`.
   9. Configure appropriate `Outbound access rules` for your organization.
   10. Click `Review + create`.
   11. Click `Create`.
7. To associate resources with an existing profile:
   1. Next to `Profile`, click `Select` to display the drop-down menu.
   2. Select a profile.
   3. Click `+ Add`.
   4. Check the box next to a PaaS resource to associate it with the network security perimeter.
   5. Click `Select`.
   6. Click `Associate`.

### Remediate from Azure CLI

Use `az network perimeter profile list` or `az network perimeter profile create` to list existing or create a new network security perimeter profile.

For each PaaS resource requiring association with a network security perimeter, run the following command:

```bash
az network perimeter association create --resource-group <resource-group> --perimeter-name <network-security-perimeter> --association-name <association> --private-link-resource "{id:<paas-resource-id>}" --profile "{<profile-id>}"
```

## Default Value

PaaS resources are not associated with a network security perimeter by default.

## References

1. https://learn.microsoft.com/en-us/azure/private-link/network-security-perimeter-concepts
2. https://learn.microsoft.com/en-us/azure/private-link/create-network-security-perimeter-portal
3. https://learn.microsoft.com/en-us/cli/azure/group
4. https://learn.microsoft.com/en-us/cli/azure/resource
5. https://learn.microsoft.com/en-us/cli/azure/network/perimeter

## Profile

Level 2 | Manual
