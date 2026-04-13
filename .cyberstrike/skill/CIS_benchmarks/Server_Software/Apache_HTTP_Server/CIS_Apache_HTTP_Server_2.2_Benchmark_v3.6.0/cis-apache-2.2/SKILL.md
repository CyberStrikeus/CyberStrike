---
name: cis-apache-2.2
description: "Ensure the Log Config Module Is Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, logging]
cis_id: "2.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Log Config Module Is Enabled

## Description

The `log_config` module provides for flexible logging of client requests and for the configuration of the information in each log.

## Rationale

Logging is critical for monitoring usage and potential abuse of your web server. To configure web server logging using the `log_format` directive, this module is required.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the `log_config` has been loaded:

Use the `httpd -M` option as root to check the module is loaded.

```bash
# httpd -M | grep log_config
```

**Note**: If the module is correctly enabled, the output will include the module name and whether it is loaded statically or as a shared module.

## Remediation

Perform either one of the following:

- For source builds with static modules, run the Apache `./configure` script without including the `--disable-log-config` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure
```

- For dynamically loaded modules, add or modify the `LoadModule` directive so that it is present in the Apache configuration as below and not commented out:

```bash
LoadModule log_config_module modules/mod_log_config.so
```

## Default Value

The module is loaded by default.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_log_config.html

## CIS Controls

Version 6

6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting
    Validate audit log settings for each hardware device and the software installed on it, ensuring that logs include a date, timestamp, source addresses, destination addresses, and various other useful elements of each packet and/or transaction. Systems should record logs in a standardized format such as syslog entries or those outlined by the Common Event Expression initiative. If systems cannot generate logs in a standardized format, log normalization tools can be deployed to convert logs into such a format.

Version 7

6.2 Activate audit logging
    Ensure that local logging has been enabled on all systems and networking devices.

6.3 Enable Detailed Logging
    Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

## Profile

Level 1 | Scored
Level 2 | Scored
