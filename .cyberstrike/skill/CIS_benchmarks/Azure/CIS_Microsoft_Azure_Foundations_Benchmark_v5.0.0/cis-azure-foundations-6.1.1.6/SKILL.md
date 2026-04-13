---
name: cis-azure-foundations-6.1.1.6
description: "Ensure logging for Azure AppService 'HTTP logs' is enabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, app-service, http-logs]
cis_id: "6.1.1.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure that logging for Azure AppService 'HTTP logs' is enabled

## Description

Enable AppServiceHTTPLogs diagnostic log category for Azure App Service instances to ensure all http requests are captured and centrally logged.

## Rationale

Capturing web requests can be important supporting information for security analysts performing monitoring and incident response activities. Once logging, these logs can be ingested into SIEM or other central aggregation point for the organization.

## Impact

Log consumption and processing will incur additional cost.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.

For each App Service:

2. Under `Monitoring`, go to `Diagnostic settings`.
3. Ensure a diagnostic setting exists that logs `HTTP logs` to a destination aligned to your environment's approach to log consumption (event hub, storage account, etc. dependent on what is consuming the logs such as SIEM or other log aggregation utility).

## Expected Result

Each App Service should have a diagnostic setting that captures HTTP logs and sends them to an appropriate destination.

## Remediation

### Remediate from Azure Portal

1. Go to `App Services`.

For each App Service:

2. Under `Monitoring`, go to `Diagnostic settings`.
3. To update an existing diagnostic setting, click `Edit setting` against the setting. To create a new diagnostic setting, click `Add diagnostic setting` and provide a name for the new setting.
4. Check the checkbox next to `HTTP logs`.
5. Configure a destination based on your specific logging consumption capability (for example Stream to an event hub and then consuming with SIEM integration for Event Hub logging).
6. Click `Save`.

## Default Value

Not configured.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/troubleshoot-diagnostic-logs
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 8.7 Collect URL Request Audit Logs | | x | x |
| v7 | 7.6 Log all URL requests | | x | x |

## Profile

Level 2 | Automated
