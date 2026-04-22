---
name: cis-ocp-v190-1.2.19
description: "Ensure that the audit logs are forwarded off the cluster for retention (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, audit, log-forwarding, retention]
cis_id: "1.2.19"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.19

## Profile Applicability
- **Level:** 1

## Description
Retain the logs for at least 30 days or as appropriate.

## Rationale
Retaining logs for at least 30 days ensures that you can go back in time and investigate or correlate any events. Set your audit log retention period to 30 days or as per your business requirements.

## Impact
None.

## Audit Procedure
OpenShift audit works at the API server level, logging all requests coming to the server. Audit is on by default. Best practice is to ship audit logs off the cluster for retention.

OpenShift includes the optional Cluster Logging operator and the `elasticSearch` operator. OpenShift cluster logging can be configured to send logs to destinations outside of your OpenShift Container Platform cluster instead of the default `elasticsearch` log store using the following methods:

- Sending logs using the `fluentd` forward protocol. You can create a `ConfigMap` to use the `fluentdForward` protocol to securely send logs to an external logging aggregator that accepts the `fluentdForward` protocol.
- Sending logs using syslog. You can create a `ConfigMap` to use the syslog protocol to send logs to an external syslog (RFC 3164) server.

Alternatively, you can use the Log Forwarding API, currently in Technology Preview. The Log Forwarding API, which is easier to configure than the `fluentdForward` protocol and syslog, exposes configuration for sending logs to the internal `elasticsearch` log store and to external `fluentd` log aggregation solutions.

You cannot use the `ConfigMap` methods and the Log Forwarding API in the same cluster.

Verify that audit log forwarding is configured as appropriate.

## Remediation
Follow the documentation for log forwarding. Forwarding logs to third party systems.

## Default Value
By default, auditing is enabled.

## References
1. https://docs.openshift.com/container-platform/latest/logging/log_collection_forwarding/log-forwarding.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process | * | * | * |
| v7 | 6.4 Ensure adequate storage for logs | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1543 | TA0003, TA0004 | M1047 |

## Profile
**Level 1** (Manual)
