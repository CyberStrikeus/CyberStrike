---
name: cis-azure-foundations-7.8
description: "Ensure virtual network flow log retention days is >= 90"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.5, cis-azure-foundations-7.6]
prerequisites: []
severity_boost: {}
---

# Ensure virtual network flow log retention days is >= 90

## Description

Ensure that virtual network flow logs are retained for greater than or equal to 90 days.

## Rationale

Virtual network flow logs provide critical visibility into traffic patterns. Logs can be used to check for anomalies and give insight into suspected breaches.

## Impact

- Virtual network flow logs are charged per gigabyte of network flow logs collected and come with a free tier of 5 GB/month per subscription.
- If traffic analytics is enabled with virtual network flow logs, traffic analytics pricing applies at per gigabyte processing rates.
- The storage of logs is charged separately, and the cost will depend on the amount of logs and the retention period.

## Audit Procedure

### Using Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click `Add filter`.
4. From the `Filter` drop-down menu, select `Flow log type`.
5. From the `Value` drop-down menu, check `Virtual network` only.
6. Click `Apply`.
7. Click the name of a virtual network flow log.
8. Under `Storage Account`, ensure that `Retention days` is set to `0`, `90`, or a number greater than 90. If `Retention days` is set to `0`, the logs are retained indefinitely with no retention policy.
9. Repeat steps 7 and 8 for each virtual network flow log.

### Using Azure CLI

Run the following command to list network watchers:

```bash
az network watcher list
```

Run the following command to list the name and retention policy of flow logs in a network watcher:

```bash
az network watcher flow-log list --location <location> --query [*].[name,retentionPolicy]
```

For each flow log, ensure that `days` is set to `0`, `90`, or a number greater than 90. If `days` is set to `0`, the logs are retained indefinitely with no retention policy.

Repeat for each network watcher.

## Expected Result

All virtual network flow logs should have retention days set to `0` (indefinite) or `>= 90` days.

## Remediation

### Remediate from Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click `Add filter`.
4. From the `Filter` drop-down menu, select `Flow log type`.
5. From the `Value` drop-down menu, check `Virtual network` only.
6. Click `Apply`.
7. Click the name of a virtual network flow log.
8. Under `Storage Account`, set `Retention days` to `0`, `90`, or a number greater than 90. If `Retention days` is set to `0`, the logs are retained indefinitely with no retention policy.
9. Repeat steps 7 and 8 for each virtual network flow log requiring remediation.

### Remediate from Azure CLI

Run the following command update the retention policy for a flow log in a network watcher, setting `retention` to `0`, `90`, or a number greater than 90:

```bash
az network watcher flow-log update --location <location> --name <flow-log> --retention <number-of-days>
```

Repeat for each virtual network flow log requiring remediation.

## Default Value

When a virtual network flow log is created using the Azure CLI, retention days is set to 0 by default. When creating via the Azure Portal, retention days must be specified by the creator.

## Additional Information

As network security group flow logs are on the retirement path, Azure recommends migrating to virtual network flow logs.

## References

1. https://learn.microsoft.com/en-us/azure/network-watcher/vnet-flow-logs-manage
2. https://learn.microsoft.com/en-us/cli/azure/network/watcher/flow-log

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 8.3 Ensure Adequate Audit Log Storage | x    | x    | x    |
| v8               | 8.10 Retain Audit Logs                |      | x    | x    |
| v7               | 6.4 Ensure adequate storage for logs  |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
|                             |         | M1047       |

## Profile

Level 2 | Automated
