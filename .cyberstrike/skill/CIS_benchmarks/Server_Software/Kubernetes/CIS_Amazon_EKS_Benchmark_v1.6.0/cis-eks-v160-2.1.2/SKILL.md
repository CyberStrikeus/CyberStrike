---
name: cis-eks-v160-2.1.2
description: "Ensure audit logs are collected and managed (Manual)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, logging, audit, control-plane]
cis_id: "2.1.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2 Ensure audit logs are collected and managed (Manual)

## Profile Applicability

- Level 1

## Description

Ensure that audit logs are collected and managed in accordance with the enterprise's audit log management process across all Kubernetes components.

## Rationale

Audit logs provide visibility into the activities occurring within a Kubernetes cluster, enabling the detection and investigation of security incidents and policy violations. Proper collection and management of audit logs are essential for maintaining an audit trail and ensuring compliance with security policies.

Implementing comprehensive audit logging may require additional storage and processing resources. Care must be taken to ensure that logs are properly secured and managed to avoid any potential security risks associated with log data.

## Audit Procedure

1. Verify audit logging is enabled for Kubernetes components:

```bash
kubectl get --raw /api/v1/nodes/${NODE_NAME}/proxy/configz | jq '.kubeletConfig.auditPolicy'
```

2. Ensure the audit logs are being collected and sent to a centralized logging system:

```bash
kubectl get --raw /api/v1/nodes/${NODE_NAME}/proxy/stats/summary | jq '.auditLogs'
```

3. Verify that the audit logs are being monitored and managed according to the enterprise's audit log management process.

## Remediation

1. Create or update the audit-policy.yaml to specify the audit logging configuration:

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: Metadata
    resources:
      - group: ""
        resources: ["pods"]
```

2. Apply the audit policy configuration to the cluster:

```bash
kubectl apply -f <path-to-audit-policy>.yaml
```

3. Ensure audit logs are forwarded to a centralized logging system like CloudWatch, Elasticsearch, or another log management solution:

```bash
kubectl create configmap cluster-audit-policy --from-file=audit-policy.yaml -n kube-system
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: audit-logging
  namespace: kube-system
spec:
  containers:
  - name: audit-log-forwarder
    image: my-log-forwarder-image
    volumeMounts:
    - mountPath: /etc/kubernetes/audit
      name: audit-config
  volumes:
  - name: audit-config
    configMap:
      name: cluster-audit-policy
EOF
```

## Default Value

By default, Kubernetes does not enable detailed audit logging. Configuration is required to enable and manage audit logs.

## References

1. [https://kubernetes.io/docs/tasks/debug-application-cluster/audit/](https://kubernetes.io/docs/tasks/debug-application-cluster/audit/)
2. [https://kubernetes.io/docs/tasks/debug-application-cluster/audit/#audit-policy](https://kubernetes.io/docs/tasks/debug-application-cluster/audit/#audit-policy)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process | X | X | X |
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |
| v7 | 6.3 Enable Detailed Logging | | X | X |
