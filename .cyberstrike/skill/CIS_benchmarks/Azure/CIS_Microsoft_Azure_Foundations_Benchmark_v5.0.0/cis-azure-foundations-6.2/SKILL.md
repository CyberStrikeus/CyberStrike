---
name: cis-azure-foundations-6.2
description: "Ensure that Resource Locks are set for Mission-Critical Azure Resources"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, governance, resource-locks, access-control]
cis_id: "6.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that Resource Locks are set for Mission-Critical Azure Resources

## Description

Resource Manager Locks provide a way for administrators to lock down Azure resources to prevent deletion of, or modifications to, a resource. These locks sit outside of the Role Based Access Controls (RBAC) hierarchy and, when applied, will place restrictions on the resource for all users. These locks are very useful when there is an important resource in a subscription that users should not be able to delete or change. Locks can help prevent accidental and malicious changes or deletion.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining resources that require resource locks depends on the context and requirements of each organization and environment.

## Rationale

As an administrator, it may be necessary to lock a subscription, resource group, or resource to prevent other users in the organization from accidentally deleting or modifying critical resources. The lock level can be set to `CanNotDelete` or `ReadOnly` to achieve this purpose.

- `CanNotDelete` means authorized users can still read and modify a resource, but they cannot delete the resource.
- `ReadOnly` means authorized users can read a resource, but they cannot delete or update the resource. Applying this lock is similar to restricting all authorized users to the permissions granted by the Reader role.

## Impact

There can be unintended outcomes of locking a resource. Applying a lock to a parent service will cause it to be inherited by all resources within. Conversely, applying a lock to a resource may not apply to connected storage, leaving it unlocked. Please see the documentation for further information.

## Audit Procedure

### Using Azure Portal

1. Navigate to the specific Azure Resource or Resource Group.
2. Click on `Locks`.
3. Ensure the lock is defined with name and description, with type `Read-only` or `Delete` as appropriate.

### Using Azure CLI

Review the list of all locks set currently:

```bash
az lock list --resource-group <resourcegroupname> --resource-name <resourcename> --namespace <Namespace> --resource-type <type> --parent ""
```

### Using PowerShell

Run the following command to list all resources:

```powershell
Get-AzResource
```

For each resource, run the following command to check for Resource Locks:

```powershell
Get-AzResourceLock -ResourceName <Resource Name> -ResourceType <Resource Type> -ResourceGroupName <Resource Group Name>
```

Review the output of the `Properties` setting. Compliant settings will have the `CanNotDelete` or `ReadOnly` value.

## Expected Result

Mission-critical Azure resources should have appropriate resource locks (CanNotDelete or ReadOnly) applied to prevent accidental or malicious modification or deletion.

## Remediation

### Remediate from Azure Portal

1. Navigate to the specific Azure Resource or Resource Group.
2. For each mission critical resource, click on `Locks`.
3. Click `Add`.
4. Give the lock a name and a description, then select the type, `Read-only` or `Delete` as appropriate.
5. Click OK.

### Remediate from Azure CLI

To lock a resource, provide the name of the resource, its resource type, and its resource group name.

```bash
az lock create --name <LockName> --lock-type <CanNotDelete/Read-only> --resource-group <resourceGroupName> --resource-name <resourceName> --resource-type <resourceType>
```

### Remediate from PowerShell

```powershell
Get-AzResourceLock -ResourceName <Resource Name> -ResourceType <Resource Type> -ResourceGroupName <Resource Group Name> -Locktype <CanNotDelete/Read-only>
```

## Default Value

By default, no locks are set.

## References

1. https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources
2. https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/design-area/management-platform#inventory-and-visibility-recommendations
3. https://learn.microsoft.com/en-us/azure/governance/blueprints/concepts/resource-locking
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-asset-management#am-4-limit-access-to-asset-management

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 2 | Manual
