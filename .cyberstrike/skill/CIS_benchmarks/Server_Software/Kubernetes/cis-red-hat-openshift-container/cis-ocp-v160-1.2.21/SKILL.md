---
name: cis-ocp-v160-1.2.21
description: "Ensure that the audit logs are forwarded off the cluster for retention (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, audit-log-retention]
cis_id: "1.2.21"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.21

## Profile Applicability

- **Level:** 1

## Description

Retain the logs for at least 30 days or as appropriate.

## Rationale

Retaining logs for at least 30 days ensures that you can go back in time and investigate or correlate any events. Set your audit log retention period to 30 days or as per your business requirements.

## Impact

None.

## Audit Procedure

OpenShift audit works at the API server level, logging all requests coming to the server. Audit is on by default. Best practice is to ship audit logs off the cluster for retention. OpenShift includes the optional Cluster Logging operator and the `elasticsearch` operator. OpenShift cluster logging can be configured to send logs to destinations outside of your OpenShift Container Platform cluster instead of the default `elasticsearch` log store using the following methods:

- Sending logs using the `fluentd` forward protocol. You can create a `ConfigMap` to use the `fluentdForward` protocol to securely send logs to an external logging aggregator that accepts the `fluentdForward` protocol.
- Sending logs using syslog. You can create a `ConfigMap` to use the syslog protocol to send logs to an external syslog (RFC 3164) server.

Alternatively, you can use the Log Forwarding API, currently in Technology Preview. The Log Forwarding API, which is easier to configure than the `fluentdForward` protocol and syslog, exposes configuration for sending logs to the internal `elasticsearch` log store and to external `fluentd` log aggregation solutions. You cannot use the `ConfigMap` methods and the Log Forwarding API in the same cluster.

Verify that audit log forwarding is configured as appropriate.

## Remediation

Follow the documentation for log forwarding. [Forwarding logs to third party systems](https://docs.openshift.com/container-platform/latest/logging/cluster-logging-external.html).

## Default Value

By default, auditing is enabled.

## References

1. https://access.redhat.com/solutions/4262201
2. https://docs.openshift.com/container-platform/latest/logging/cluster-logging-external.html
3. https://docs.openshift.com/container-platform/latest/security/audit-log-view.html
4. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L41-L77
5. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
6. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
7. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
8. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/
9. https://github.com/kubernetes/features/issues/22

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | x    | x    | x    |
| v7               | 6.4 Ensure adequate storage for logs                       |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1543                       | TA0003, TA0004 | M1047       |

## Profile

**Level 1** (Manual)
