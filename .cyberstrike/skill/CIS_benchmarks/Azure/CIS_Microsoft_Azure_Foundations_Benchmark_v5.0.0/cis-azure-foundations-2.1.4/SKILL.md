---
name: cis-azure-foundations-2.1.4
description: "Ensure users and groups are synced from Microsoft Entra ID to Azure Databricks"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.5, cis-azure-foundations-2.1.6]
prerequisites: []
severity_boost: {}
---

# Ensure users and groups are synced from Microsoft Entra ID to Azure Databricks

## Description

To ensure centralized identity and access management, users and groups from Microsoft Entra ID should be synchronized with Azure Databricks. This is achieved through SCIM provisioning, which automates the creation, update, and deactivation of users and groups in Databricks based on Entra ID assignments. Enabling this integration ensures that access controls in Databricks remain consistent with corporate identity governance policies, reducing the risk of orphaned accounts, stale permissions, and unauthorized access.

## Rationale

Syncing users and groups from Microsoft Entra ID centralizes access control, enforces the least privilege principle by automatically revoking unnecessary access, reduces administrative overhead by eliminating manual user management, and ensures auditability and compliance with industry regulations.

## Impact

SCIM provisioning requires role mapping to avoid misconfigured user privileges.

## Audit Procedure

### Audit from Azure Portal

Verify SCIM provisioning is enabled:

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Enterprise applications`.
3. Click the name of the Azure Databricks SCIM application.
4. Under `Provisioning`, confirm that SCIM provisioning is enabled and running.

Check user sync status in Azure Portal:

5. Under `Provisioning Logs`, verify the last successful sync and any failed entries.

Check user sync status in Databricks:

6. Go to `Admin Console` > `Identity and Access Management`.
7. Confirm that Users and Groups match those assigned in Microsoft Entra ID.

Ensure role-based access control (RBAC) mapping is correct:

8. Verify that users are assigned appropriate Databricks roles (e.g. Admin, User, Contributor).
9. Confirm that groups are mapped to workspace access roles.

## Expected Result

SCIM provisioning should be enabled and running. Users and groups in Azure Databricks should match those in Microsoft Entra ID. All role assignments should follow the least privilege principle.

## Remediation

### Remediate from Azure Portal

Enable provisioning in Azure Portal:

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Enterprise applications`.
3. Click the name of the Azure Databricks SCIM application.
4. Under `Provisioning`, select `Automatic` and enter the SCIM endpoint and API token from Databricks.

Enable provisioning in Databricks:

5. Navigate to `Admin Console` > `Identity and Access Management`.
6. Enable SCIM provisioning and generate an API token.

Configure role assignments:

7. Ensure groups from Entra ID are mapped to appropriate Databricks roles.
8. Restrict administrative privileges to designated security groups.

Regularly monitor sync logs:

9. Periodically review sync logs in Microsoft Entra ID and Databricks Admin Console.
10. Configure Azure Monitor alerts for provisioning failures.

Disable manual user creation in Databricks:

11. Ensure that all user management is controlled via SCIM sync from Entra ID.
12. Disable personal access token usage for authentication.

### Remediate from Azure CLI

Enable SCIM User and Group Provisioning in Azure Databricks:

```bash
az ad app update --id <databricks-app-id> --set provisioning.provisioningMode=Automatic
```

## Default Value

By default, Azure Databricks does not sync users and groups from Microsoft Entra ID.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/administration-guide/users-groups/scim/aad

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                               |      | x    | x    |
| v7               | 16.2 Configure Centralized Point of Authentication               |      | x    | x    |

## Profile

Level 1 | Manual
