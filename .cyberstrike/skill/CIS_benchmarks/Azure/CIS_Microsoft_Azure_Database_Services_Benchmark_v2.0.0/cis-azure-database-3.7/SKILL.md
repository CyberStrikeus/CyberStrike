---
name: cis-azure-database-3.7
description: "Ensure that Cosmos DB Logging is Enabled"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.7"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.7 Ensure that Cosmos DB Logging is Enabled (Manual)

## Profile Applicability

- Level 1

## Description

Cosmos DB logs should be captured to track events relevant to auditing and diagnostics.

## Rationale

Logging of changes, events, and information related to Cosmos DB provides a diagnostic tool and a forensic record of activity. An effective set of logs help provide integrity and availability to the service and contribute to the effectiveness of detective systems such as a SIEM.

## Impact

There may be additional storage costs for logging a large amount of events. Potentially only keep logs for a certain timeframe before they are deleted.

## Audit Procedure

**NOTE:** This procedure assumes a Log Analytics Workspace or other logging destination already exists. Please see attached resources on this setup.

### Audit from Azure Portal

1. From `Azure CosmosDB`, select the database you wish to audit.
2. Scroll down in the left column and select `> Monitoring`.
3. Select **Diagnostic Settings**.
4. Determine if there are any diagnostic settings that are being sent to a logging location. You will need to open each listed and determine if `allLogs` under `Category groups` is checked.

### Audit from PowerShell

1. Get the CosmosDB accounts for a specific resource group. Repeat for each resource group as necessary.

```powershell
Get-AzCosmosDBAccount -ResourceGroupName <resource group name>
```

2. For each CosmosDB, determine which log categories are enabled for each account using the *Id* of each CosmosDB Account.

```powershell
Get-AzDiagnosticSetting -ResourceId <CosmosDB Account Id>
```

3. Within the output of the above command, ensure the log categories have *Enabled* set to *true*.

## Expected Result

Diagnostic settings should be configured with `allLogs` enabled under `Category groups`, sending logs to an appropriate logging destination (Log Analytics Workspace, Storage Account, or Event Hub).

## Remediation

**NOTE:** This procedure assumes a Log Analytics Workspace or other logging destination already exists. Please see attached resources on this setup.

### Remediate from Azure Portal

1. From `Azure CosmosDB`, select the database you wish to audit.
2. Scroll down in the left column and select `> Monitoring`.
3. Select **Diagnostic Settings**.
4. Select `+ Add Diagnostic Setting`
5. Enter your name for this setting in `Diagnostic Setting Name`.
6. Select `allLogs` under `Category groups`
7. Select `Send to Log Analytics workspace` or other logging solution under `Destination details`.
8. Select your Azure subscription, and your log analytics workspace, or other connection details depending on your logging solution.
9. Select **Save** in the top left corner.

### Remediate from PowerShell

For each CosmosDB account out of compliance, enable the logging by running the following command:

```powershell
$categories = @(
    @{
        Category="ControlPlaneRequests";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    },
    @{
        Category="DataPlaneRequests";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    },
    @{
        Category="MongoRequests";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    },
    @{
        Category="SqlRequests";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    },
    @{
        Category="GremlinQueries";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    },
    @{
        Category="TableRequests";
        Enabled=$true;
        RetentionPolicy=@{ Enabled=$false; Days=0 }
    }
)

Set-AzDiagnosticSetting -Name <name of new CosmosDB diagnostic setting> -ResourceId <CosmosDB Account Id> -WorkspaceId <log analytics workspace id> -Categories $categories -Enabled $true
```

## Default Value

By default, event logging for Azure Cosmos DB is not enabled.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-monitor/logs/quick-create-workspace](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/quick-create-workspace)
2. [https://learn.microsoft.com/en-us/azure/cosmos-db/monitor](https://learn.microsoft.com/en-us/azure/cosmos-db/monitor)
3. [https://www.azadvertizer.net/azpolicyadvertizer/45c6bfc7-4520-4d64-a158-730cd92eedbc.html](https://www.azadvertizer.net/azpolicyadvertizer/45c6bfc7-4520-4d64-a158-730cd92eedbc.html)
