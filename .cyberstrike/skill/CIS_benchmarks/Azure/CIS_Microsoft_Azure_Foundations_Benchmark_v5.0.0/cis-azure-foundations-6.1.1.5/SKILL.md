---
name: cis-azure-foundations-6.1.1.5
description: "Ensure Network Security Group Flow logs are captured and sent to Log Analytics"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, nsg, flow-logs, network]
cis_id: "6.1.1.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.7]
prerequisites: []
severity_boost: {}
---

# Ensure that Network Security Group Flow logs are captured and sent to Log Analytics

## Description

Ensure that network flow logs are captured and fed into a central log analytics workspace.

**Retirement Notice**: On September 30, 2027, network security group (NSG) flow logs will be retired. As of June 30, 2025, creating new NSG flow logs is no longer possible. Azure recommends migrating to virtual network flow logs.

## Rationale

Network Flow Logs provide valuable insight into the flow of traffic around your network and feed into both Azure Monitor and Azure Sentinel (if in use), permitting the generation of visual flow diagrams to aid with analyzing for lateral movement, etc.

## Impact

The impact of configuring NSG Flow logs is primarily one of cost and configuration. If deployed, it will create storage accounts that hold minimal amounts of data on a 5-day lifecycle before feeding to Log Analytics Workspace. This will increase the amount of data stored and used by Azure Monitor.

## Audit Procedure

### Using Azure Portal

1. Navigate to `Network Watcher`.
2. Under `Logs`, select `Flow logs`.
3. Click `Add filter`.
4. From the `Filter` drop-down, select `Flow log type`.
5. From the `Value` drop-down, check `Network security group` only.
6. Click `Apply`.
7. Ensure that at least one network security group flow log is listed and is configured to send logs to a `Log Analytics Workspace`.

## Expected Result

At least one NSG flow log should exist and be configured to send logs to a Log Analytics Workspace. Consider migrating to virtual network flow logs as NSG flow logs are being retired.

## Remediation

As of June 30, 2025, creating new NSG flow logs is no longer possible. Azure recommends migrating to virtual network flow logs. Consider applying the recommendation, `Ensure that virtual network flow logs are captured and sent to Log Analytics`, from this section.

## Default Value

By default Network Security Group logs are not sent to Log Analytics.

## References

1. https://learn.microsoft.com/en-us/azure/network-watcher/nsg-flow-logs-tutorial
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-4-enable-network-logging-for-security-investigation

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 13.6 Collect Network Traffic Flow Logs | | x | x |
| v7 | 12.8 Deploy NetFlow Collection on Networking Boundary Devices | | x | x |

## Profile

Level 2 | Manual
