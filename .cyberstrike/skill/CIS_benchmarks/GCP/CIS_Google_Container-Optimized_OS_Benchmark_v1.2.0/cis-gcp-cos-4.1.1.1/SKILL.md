---
name: cis-gcp-cos-4.1.1.1
description: "Ensure correct container image is set for stackdriver logging agent"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, stackdriver]
cis_id: "4.1.1.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.1 Ensure correct container image is set for stackdriver logging agent (Automated)

## Description

`stackdriver-logging` service runs stackdriver container image to export logs to Cloud Logging.

Note: This recommendation is not applicable for COS images using Fluent-bit as it isn't containerized.

## Rationale

If the logging agent is not set correctly, the logs cannot be exported to Cloud Logging.

## Audit Procedure

Verify `LOGGING_AGENT_DOCKER_IMAGE` is set to a correct stackdriver container image. Use the following command to verify:

```bash
# grep LOGGING_AGENT_DOCKER_IMAGE /etc/stackdriver/env_vars
LOGGING_AGENT_DOCKER_IMAGE="gcr.io/stackdriver-agents/stackdriver-logging-agent:<version>"
```

## Expected Result

The output should show `LOGGING_AGENT_DOCKER_IMAGE` set to a valid `gcr.io/stackdriver-agents/stackdriver-logging-agent:<version>` image.

## Remediation

Edit the `LOGGING_AGENT_DOCKER_IMAGE` variable in the `/etc/stackdriver/env_vars` file to set the correct logging agent.

Run the following command to restart `stackdriver-logging` service:

```bash
# systemctl restart stackdriver-logging
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.2 Collect Audit Logs** - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v8 | **8.5 Collect Detailed Audit Logs** - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | x | x |
| v7 | **6.2 Activate audit logging** - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |
| v7 | **6.3 Enable Detailed Logging** - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | x | x |

## Profile

- Level 2 - Server
