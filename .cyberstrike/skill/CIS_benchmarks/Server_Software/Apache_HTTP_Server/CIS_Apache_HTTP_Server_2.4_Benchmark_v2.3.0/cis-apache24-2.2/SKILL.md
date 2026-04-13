---
name: cis-apache24-2.2
description: "Ensure the Log Config Module Is Enabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, logging]
cis_id: "2.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2 Ensure the Log Config Module Is Enabled (Automated)

## Profile Applicability
- Level 1

## Description
The `log_config` module provides for flexible logging of client requests, and provides for the configuration of the information in each log.

## Rationale
Logging is critical for monitoring usage and potential abuse of your web server. This module is required to configure web server logging using the `log_format` directive.

## Audit
Perform the following to determine if the `log_config` has been loaded:

Use the `httpd -M` option as root to check that the module is loaded.

```bash
# httpd -M | grep log_config
```

**Note**: If the module is correctly enabled, the output will include the module name and whether it is loaded statically or as a shared module

## Remediation
Perform either one of the following:

- For source builds with static modules, run the Apache `./configure` script without including the `--disable-log-config` script options.
  - `$ cd $DOWNLOAD_HTTPD`
  - `$ ./configure`
- For dynamically loaded modules, add or modify the LoadModule directive so that it is present in the apache configuration as below and not commented out:
  - `LoadModule log_config_module modules/mod_log_config.so`

## Default Value
The `log_config` module is loaded by default.

## References
1. https://httpd.apache.org/docs/2.4/mod/mod_log_config.html

## CIS Controls
- v8: 8.2 Collect Audit Logs
- v7: 6.2 Activate audit logging
- v7: 6.3 Enable Detailed Logging

## Profile
- Level 1
