---
name: cis-azure-compute-3.2
description: "Ensure a Managed Identity is used for interactions with other Azure services"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, container-instances, aci]
cis_id: "3.2"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a Managed Identity is used for interactions with other Azure services

## Description

For containers that require access to other resources, or other resources accessing a container, an identity/credential may be required. The Managed Identity prevents needing to store credentials in code within the Container Instance. There are two types of Managed Identities for Container Instances:

1. **System Assigned**: System Assigned Managed Identities provide an infrastructure integrated identity which is unique to the resource. It is assigned to the Container Instance and persists for the lifecycle of the resource. Permissions can be assigned, revoked, and tuned using Azure role-based access control.
2. **User Assigned**: User Assigned Managed Identities are not unique to the resource, and exist as independent Azure resources with their own lifecycle. If a Container Identity is decommissioned, the User Assigned Managed Identity will need to be decommissioned separately. User Assigned Managed Identities are not necessarily unique, and can be used across multiple resources.

## Rationale

Identities or credentials stored within a Container Instance or the code running on the Container Instance introduce a risk of compromise. If that identity or credential is stored in plain text, the risk is further amplified.

## Impact

To ensure that a Managed Identity is able to access a destination resource, the permissions and/or role assigned to that Managed Identity will need to be evaluated.

## Audit Procedure

### Using Azure Portal

For each Container Instance that uses an identity or credential:

1. Open the `Container Instances` blade.
2. Select a named container instance.
3. Click on `Identity` under the Settings section.
4. Review the `System Assigned` and `User Assigned` tabs for assigned identities:
   - If using `System Assigned` identities, ensure status is set to `On`.
   - If using `User Assigned` identities, ensure only necessary user identities are assigned.

### Using Azure CLI

Run the following command:

```bash
az container list
```

For each Container Instance that uses an identity or credential, ensure `"identity":` is not `"null"`.

## Expected Result

Container Instances that interact with other Azure services should have a Managed Identity configured (either System Assigned or User Assigned). The `"identity"` field should not be `null`.

## Remediation

### Using Azure Portal

For each Container Instance that requires an identity or credential:

1. Open the `Container Instances` blade.
2. Select a named container instance.
3. Click on `Identity` under the Settings section, then:
   - For a System Assigned identity, click the `System Assigned` tab then set status to `On`.
   - For User Assigned identities, click the `User Assigned` tab then click the `Add` button. Search for the required user managed identity, then click the `Add` button at the bottom of the window.

### Using Azure CLI

To assign Managed Identities to Container Instances by CLI, the Managed Identity will need to be specified at the time of creation. If a Container Instance requires a Managed Identity, but does not already have one, it will need to be re-created with the Managed Identity specified.

System Assigned Identity:

```bash
az container create -g <MyResourceGroup> --name <MyContainerInstanceName> --image <MyImage> --assign-identity [system]
```

User Assigned Identities:

```bash
az container create -g <MyResourceGroup> --name <MyContainerInstanceName> --image <MyImage> --assign-identity </subscriptions/MySubscriptionID/resourcegroups/MyResourceGroup/providers/Microsoft.ManagedIdentity/userAssignedIdentities/MyUserAssignedIdentity>
```

BOTH System and User Assigned Identities:

```bash
az container create -g <MyResourceGroup> --name <MyContainerInstanceName> --image <MyImage> --assign-identity [system] </subscriptions/MySubscriptionID/resourcegroups/MyResourceGroup/providers/Microsoft.ManagedIdentity/userAssignedIdentities/MyUserAssignedIdentity>
```

## Default Value

By default, Managed Identities are not configured on Container Instances.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/container-instances-security-baseline?toc=%2Fazure%2Fcontainer-instances%2FTOC.json#identity-management
2. https://learn.microsoft.com/en-us/azure/container-instances/using-azure-container-registry-mi

## Profile

Level 1 | Manual
