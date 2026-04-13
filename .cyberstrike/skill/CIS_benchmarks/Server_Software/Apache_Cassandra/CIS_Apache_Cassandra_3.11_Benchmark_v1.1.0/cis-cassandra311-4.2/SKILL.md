---
name: cis-cassandra311-4.2
description: "Ensure that auditing is enabled"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, auditing, logging]
cis_id: "4.2"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure that auditing is enabled

## Profile Applicability
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description
Audit logging in Cassandra logs every incoming CQL command request, Authentication (successful as well as unsuccessful login) to C* node. Currently, there are two implementations provided, the custom logger can be implemented and injected with the class name as parameter in cassandra.yaml.

## Rationale
Unauthorized attempts to create, drop or alter users or data should be a concern.

## Audit

**Open Source Version**
Apache Cassandra versions up to 3.11.4 does not have auditing capabilities, it will be in version 4.x but that has not been released yet according to apache Cassandra website.
https://cassandra.apache.org/download/

**Commercial Version**
Allows via DataStax allows logging to filesystem log files using logback, or to a Cassandra table. When you turn on audit logging, the default is to write to logback filesystem log files. If using DataStax version you can verify auditing is turned on.

```bash
cat dse.yaml | grep "audit_logging_options"
```

If failure is enabled: true means success
Anything else is a finding

## Remediation

**Open Source Version**
Apache Cassandra versions up to 3.11.4 does not have auditing capabilities, it will be in version 4.x but that has not been released yet according to apache Cassandra website.
https://cassandra.apache.org/download/

**Commercial Version**
Open the dse.yaml file in a text editor
In the audit_logging_options section, set enabled to true.

You must also define where you want logging to go, add either of the following lines:
Set the logger option to either CassandraAuditWriter, which logs to a table, or
SLF4JAuditWriter, which logs to the SLF4J logger.

## Default Value
Auditing is disabled by default.

## References
1. https://docs.datastax.com/en/datastax_enterprise/4.8/datastax_enterprise/sec/se cAudit.html#secAudit

## CIS Controls
- v8: 8.2 Collect Audit Logs
- v7: 6.2 Activate audit logging

## Profile
- Level 1 | Manual
