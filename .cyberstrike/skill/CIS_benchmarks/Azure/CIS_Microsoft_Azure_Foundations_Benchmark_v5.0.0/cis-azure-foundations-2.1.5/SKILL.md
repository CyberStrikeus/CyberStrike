---
name: cis-azure-foundations-2.1.5
description: "Ensure Unity Catalog is configured for Azure Databricks"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure Unity Catalog is configured for Azure Databricks

## Description

Unity Catalog is a centralized governance model for managing and securing data in Azure Databricks. It provides fine-grained access control to databases, tables, and views using Microsoft Entra ID identities. Unity Catalog also enhances data lineage, audit logging, and compliance monitoring, making it a critical component for security and governance.

## Rationale

- Enforces centralized access control policies and reduces data security risks.
- Enables identity-based authentication via Microsoft Entra ID.
- Improves compliance with industry regulations (e.g. GDPR, HIPAA, SOC 2) by providing audit logs and access visibility.
- Prevents unauthorized data access through table-, row-, and column-level security (RLS & CLS).

## Impact

- Improperly configured permissions may lead to data exfiltration or unauthorized access.
- Unity Catalog requires structured governance policies to be effective and prevent overly permissive access.

## Audit Procedure

### Method 1: Verify Unity Catalog deployment

1. As an Azure Databricks account admin, log into the account console.
2. Click Workspaces.
3. Find your workspace and check the Metastore column. If a metastore name is present, your workspace is attached to a Unity Catalog metastore and therefore enabled for Unity Catalog.

### Method 2: Run a SQL query to confirm Unity Catalog enablement

Run the following SQL query in the SQL query editor or a notebook that is attached to a Unity Catalog-enabled compute resource. No admin role is required.

```sql
SELECT CURRENT_METASTORE();
```

If the query returns a metastore ID, then your workspace is attached to a Unity Catalog metastore and therefore enabled for Unity Catalog.

## Expected Result

The workspace should be attached to a Unity Catalog metastore. The CURRENT_METASTORE() query should return a valid metastore ID.

## Remediation

Use the remediation procedure written in this article: https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/get-started.

## Default Value

New workspaces have Unity Catalog enabled by default. Existing workspaces may require manual enablement.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/
2. https://learn.microsoft.com/en-us/azure/databricks/admin/users-groups/
3. https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/enable-workspaces

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                  |      | x    | x    |
| v8               | 6.7 Centralize Access Control                      | x    |      | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |

## Profile

Level 1 | Manual
