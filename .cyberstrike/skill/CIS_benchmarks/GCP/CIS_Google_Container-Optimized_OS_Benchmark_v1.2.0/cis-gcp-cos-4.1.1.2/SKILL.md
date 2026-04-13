---
name: cis-gcp-cos-4.1.1.2
description: "Ensure Logging Service is Running"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, stackdriver, journald]
cis_id: "4.1.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.2 Ensure Logging Service is Running (Manual)

## Description

Some form of logging for the OS should be used. On COS Stackdriver-logging agent or fluent-bit logging agent are provided and can be activated simply by following the guides. It is not require to use these for logging but they are simple to set up and will work well.

## Rationale

If no logging is running, their will be less of a trail for audit if things go wrong. It is a good practice to have logging enabled for better visibility.

## Audit Procedure

This audit procedure is only if you are using one of the supporting logging services described.

**Stackdriver-Logging Agent**

Run the following command to verify `stackdriver-logging` is running:

```bash
# systemctl status stackdriver-logging | grep Active
Active: active (running) since <Day date time>
```

**Fluent-bit Logging**

Or if your system has fluent-bit, run the following command to verify `fluent-bit` is running:

```bash
# systemctl status fluent-bit | grep Active
Active: active (running) since <Day date time>
```

## Expected Result

The output should show `Active: active (running)` for either `stackdriver-logging` or `fluent-bit`.

## Remediation

This remediation is only if you want to use one of the supported logging services described.

**Stackdriver-logging Agent**

Run the following command to enable `stackdriver-logging`:

```bash
# systemctl start stackdriver-logging
```

**Fluent-bit Logging**

Run the following command to enable `fluent-bit`:

```bash
# systemctl start fluent-bit
```

**Works for Both**

Simply update the instance metadata to enable logging as follows:

```bash
# gcloud compute instances add-metadata <instance-name> \
    --zone <compute-zone> \
    --metadata google-logging-enabled=true
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.2 Collect Audit Logs** - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v8 | **8.5 Collect Detailed Audit Logs** - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | x | x |
| v7 | **6.2 Activate audit logging** - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |
| v7 | **6.3 Enable Detailed Logging** - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | x | x |

## Profile

- Level 2 - Server
