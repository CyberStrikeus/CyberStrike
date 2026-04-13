---
name: cis-cassandra40-v130-4.2
description: "Ensure that auditing is enabled"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, auditing, logging]
cis_id: "4.2"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure that auditing is enabled

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description

Audit logging in Cassandra logs every incoming CQL command request, Authentication (successful as well as unsuccessful) to C* node. Currently, there are two implementations provided, the custom logger can be implemented and injected with the class name as a parameter in cassandra.yaml.

## Rationale

Unauthorized attempts to create, drop or alter users or data should be a concern.

## Audit

Allows logging to filesystem log files using logback or to a Cassandra table. When you turn on audit logging, the default is to write to logback filesystem log files. You can verify auditing is turned on:

```bash
cat cassandra.yaml | grep -Al "audit_logging_options"
```

If enabled is set to true, then success. Anything else is a finding.

## Remediation

Open the `cassandra.yaml` file in a text editor

In the `audit_logging_options` section, set `enabled` to `true`.

```yaml
# Audit logging options
audit_logging_options:
    enabled: true
```

## References

1. https://docs.datastax.com/en/datastax_enterprise/4.8/datastax_enterprise/sec/secAudit.html#secAudit

## CIS Controls

**Controls Version v8:**
- 8.2 Collect Audit Logs
  - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.

**Controls Version v7:**
- 6.2 Activate audit logging
  - Ensure that local logging has been enabled on all systems and networking devices.

## Profile
- Level 1 | Manual
