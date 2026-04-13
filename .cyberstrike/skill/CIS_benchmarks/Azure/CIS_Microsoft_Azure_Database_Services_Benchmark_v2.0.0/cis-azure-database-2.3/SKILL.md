---
name: cis-azure-database-2.3
description: "Ensure that 'Minimum TLS version' is set to TLS v1.2 (or higher)"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3 Ensure that 'Minimum TLS version' is set to TLS v1.2 (or higher) (Manual)

## Profile Applicability

- Level 1

## Description

Setting the 'Minimum TLS version' helps reduce (but not eliminate) TLS protocol vulnerabilities by preventing the use of significantly outdated versions of TLS.

## Rationale

The Secure Sockets Layer (SSL) protocol encrypts network traffic transiting between server and client.

Using only the most recent versions of SSL protocols (TLS version 1.2 and higher) eliminates susceptibility to known exploited vulnerabilities of outdated versions of TLS. If TLS 1.2 does not provide additional granular configuration options for supported cipher suites, there's a chance that default ciphers which employ Cipher Block Chaining (CBC) mode may be enabled which would introduce Padding Oracle types of vulnerabilities. TLS 1.3 does not support CBC mode ciphers by default and by default supports GCM ciphers which include an extra authentication step during the clear text to cipher text encryption process.

TLS version 1.3 is preferable where it is possible to implement.

Versions 1.0 and 1.1 of TLS are no longer considered secure. These versions should not be used or permitted where data integrity and confidentiality are required.

## Impact

This configuration setting should not result in any perceptible changes to cost or performance.

## Audit Procedure

### Audit From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance listed, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Advanced Settings**
5. Review the setting under `Minimum TLS version`

If `1.2 (Recommended)` (or a higher version) is selected, the configuration for that instance is compliant.

## Expected Result

The `Minimum TLS version` should be set to `1.2 (Recommended)` or higher for each Azure Cache for Redis instance.

## Remediation

### Remediate From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance listed, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Advanced Settings**
5. Click the drop-down menu under `Minimum TLS version`
6. Select `1.2 (Recommended)` (higher versions are preferred when available)

## Default Value

By default, 'Minimum TLS version' is set to TLS 1.2.

## References

1. [https://www.rfc-editor.org/rfc/pdfrfc/rfc8446.txt.pdf](https://www.rfc-editor.org/rfc/pdfrfc/rfc8446.txt.pdf)
2. [https://nvd.nist.gov/vuln/detail/CVE-2016-0701](https://nvd.nist.gov/vuln/detail/CVE-2016-0701)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | X | X |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | X | X |
