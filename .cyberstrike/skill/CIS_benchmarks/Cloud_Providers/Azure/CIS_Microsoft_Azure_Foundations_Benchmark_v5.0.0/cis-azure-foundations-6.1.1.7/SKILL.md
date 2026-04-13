---
name: cis-azure-foundations-6.1.1.7
description: "Ensure virtual network flow logs are captured and sent to Log Analytics"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, vnet, flow-logs, network]
cis_id: "6.1.1.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.5]
prerequisites: []
severity_boost: {}
---

# Ensure that virtual network flow logs are captured and sent to Log Analytics

## Description

Ensure that virtual network flow logs are captured and fed into a central log analytics workspace.

## Rationale

Virtual network flow logs provide critical visibility into traffic patterns. Sending logs to a Log Analytics workspace enables centralized analysis, correlation, and alerting for faster threat detection and response.

## Impact

- Virtual network flow logs are charged per gigabyte of network flow logs collected and come with a free tier of 5 GB/month per subscription.
- If traffic analytics is enabled with virtual network flow logs, traffic analytics pricing applies at per gigabyte processing rates.
- The storage of logs is charged separately.

## Audit Procedure

### Using Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click `Add filter`.
4. From the `Filter` drop-down menu, select `Flow log type`.
5. From the `Value` drop-down menu, check `Virtual network` only.
6. Click `Apply`.
7. Ensure that at least one virtual network flow log is listed and is configured to send logs to a `Log Analytics Workspace`.

## Expected Result

At least one virtual network flow log should exist and be configured to send logs to a Log Analytics Workspace with traffic analytics enabled.

## Remediation

### Remediate from Azure Portal

1. Go to `Network Watcher`.
2. Under `Logs`, click `Flow logs`.
3. Click `+ Create`.
4. Select a subscription.
5. Next to `Flow log type`, select `Virtual network`.
6. Click `+ Select target resource`.
7. Select `Virtual network`.
8. Select a virtual network.
9. Click `Confirm selection`.
10. Select a storage account, or create a new storage account.
11. Set the retention in days for the storage account.
12. Click `Next`.
13. Under `Analytics`, for `Flow logs version`, select `Version 2`.
14. Check the box next to `Enable traffic analytics`.
15. Select a processing interval.
16. Select a `Log Analytics Workspace`.
17. Click `Next`.
18. Optionally, add `Tags`.
19. Click `Review + create`.
20. Click `Create`.
21. Repeat steps 1-20 for each subscription or virtual network requiring remediation.

## Default Value

By default, virtual network flow logs are not configured.

## References

1. https://learn.microsoft.com/en-us/azure/network-watcher/vnet-flow-logs-overview
2. https://learn.microsoft.com/en-us/azure/network-watcher/vnet-flow-logs-cli

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.6 Collect Network Traffic Flow Logs                        |      | x    | x    |
| v7               | 12.8 Deploy NetFlow Collection on Networking Boundary Devices |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
|            |         | M1047       |

## Profile

Level 2 | Manual
