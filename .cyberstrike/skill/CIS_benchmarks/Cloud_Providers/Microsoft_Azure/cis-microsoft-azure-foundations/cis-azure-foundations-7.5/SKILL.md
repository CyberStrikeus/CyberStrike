---
name: cis-azure-foundations-7.5
description: "Ensure network security group flow log retention days is >= 90"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.6, cis-azure-foundations-7.8]
prerequisites: []
severity_boost: {}
---

# Ensure network security group flow log retention days is >= 90

## Description

Network security group flow logs should be enabled and the retention period set to greater than or equal to 90 days.

**Retirement Notice:** On September 30, 2027, network security group (NSG) flow logs will be retired. As of June 30, 2025, creating new NSG flow logs is no longer possible. Azure recommends migrating to virtual network flow logs. Review https://azure.microsoft.com/en-us/updates/?id=Azure-NSG-flow-logs-Retirement for more information.

For virtual network flow logs, consider applying the recommendation `Ensure that virtual network flow log retention days is set to greater than or equal to 90` in this section.

## Rationale

Flow logs enable capturing information about IP traffic flowing in and out of network security groups. Logs can be used to check for anomalies and give insight into suspected breaches.

## Impact

This will keep IP traffic logs for 90 days or longer. As a level 2 control, first determine your need to retain data, then apply your selection here. As this is data stored for a longer period, your monthly storage costs will increase depending on your data use.

## Audit Procedure

### Using Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click the name of a network security group flow log.
4. Ensure that `Status` is set to `On`.
5. Ensure that `Retention days` is set to `0`, `90`, or a number greater than 90. If `Retention days` is set to `0`, the logs are retained indefinitely with no retention policy.
6. Repeat steps 1-5 for each network security group flow log.

### Using Azure CLI

Run the following command to list network watchers:

```bash
az network watcher list
```

Run the following command to list the name and retention policy of flow logs in a network watcher:

```bash
az network watcher flow-log list --location <location> --query [*].[name,retentionPolicy]
```

For each network security group flow log, ensure that `enabled` is set to `true`, and `days` is set to `0`, `90`, or a number greater than 90. If `days` is set to `0`, the logs are retained indefinitely with no retention policy.

## Expected Result

All network security group flow logs should have status `On` with retention days set to `0` (indefinite) or `>= 90` days.

## Remediation

### Remediate from Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click the name of a network security group flow log.
4. Set `Status` to `On`.
5. Set `Retention days` to `0`, `90`, or a number greater than 90. If `Retention days` is set to `0`, the logs are retained indefinitely with no retention policy.
6. Click `Save`.
7. Repeat steps 1-6 for each network security group flow log requiring remediation.

### Remediate from Azure CLI

For each network security group flow log requiring remediation, run the following command to enable the flow log and set `retention` to `0`, `90`, or a number greater than 90:

```bash
az network watcher flow-log configure --nsg <network-security-group> --enabled true --resource-group <resource-group> --retention <number-of-days> --storage-account <storage-account>
```

## Default Value

By default, network security group flow logs are `disabled`.

## References

1. https://learn.microsoft.com/en-us/azure/network-watcher/nsg-flow-logs-overview
2. https://learn.microsoft.com/en-us/cli/azure/network/watcher/flow-log
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-6-configure-log-storage-retention
4. https://learn.microsoft.com/en-gb/azure/network-watcher/nsg-flow-logs-migrate

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 8.3 Ensure Adequate Audit Log Storage | x    | x    | x    |
| v8               | 8.10 Retain Audit Logs                |      | x    | x    |
| v7               | 6.4 Ensure adequate storage for logs  |      | x    | x    |

## Profile

Level 2 | Automated
