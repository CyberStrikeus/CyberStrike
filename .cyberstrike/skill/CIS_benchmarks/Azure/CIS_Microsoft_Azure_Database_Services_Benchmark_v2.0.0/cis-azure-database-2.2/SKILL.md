---
name: cis-azure-database-2.2
description: "Ensure that 'Allow access only via SSL' is set to 'Yes'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.2"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2 Ensure that 'Allow access only via SSL' is set to 'Yes' (Automated)

## Profile Applicability

- Level 1

## Description

Setting 'Allow access only via SSL' to 'Yes' ensures that data in transit to and from Azure Cache for Redis is encrypted using TLS.

## Rationale

Data in transit which is not encrypted is vulnerable to attacks including adversary-in-the-middle (AITM or MITM), eavesdropping, or session hijack. These attacks can result in the compromise and exfiltration of data.

## Impact

No additional cost is required to implement this recommendation. Aside from expected network changes (no unencrypted communications), performance should not be impacted.

## Audit Procedure

### Audit From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Advanced Settings**
5. Review the setting under `Allow access only via SSL`

If **Yes** is selected, the configuration for that instance is compliant.

### Audit From Azure Policy

- **Policy ID:** `22bee202-a82f-4305-9a2a-6d7f44d4dedb` - **Name:** 'Only secure connections to your Azure Cache for Redis should be enabled'
- **Policy ID:** `766f5de3-c6c0-4327-9f4d-042ab8ae846c` - **Name:** 'Configure Azure Cache for Redis to disable non SSL ports'

## Expected Result

The `Allow access only via SSL` setting should be set to **Yes** for each Azure Cache for Redis instance.

## Remediation

### Remediate From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Advanced Settings**
5. Select **Yes** under `Allow access only via SSL` heading

## Default Value

By default, 'Allow access only via SSL' is set to 'Yes'.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-best-practices-development](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-best-practices-development)
2. [https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-cache-for-redis-security-baseline#microsoft-defender-for-cloud-monitoring-1](https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-cache-for-redis-security-baseline#microsoft-defender-for-cloud-monitoring-1)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | X | X |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | X | X |
