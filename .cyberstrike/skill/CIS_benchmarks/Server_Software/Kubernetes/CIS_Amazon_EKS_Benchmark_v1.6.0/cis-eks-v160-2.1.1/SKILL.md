---
name: cis-eks-v160-2.1.1
description: "Enable audit Logs (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, logging, audit, control-plane]
cis_id: "2.1.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1 Enable audit Logs (Automated)

## Profile Applicability

- Level 1

## Description

Control plane logs provide visibility into operation of the EKS Control plane component systems. The API server audit logs record all accepted and rejected requests in the cluster. When enabled via EKS configuration the control plane logs for a cluster are exported to a CloudWatch Log Group for persistence.

## Rationale

Audit logs enable visibility into all API server requests from authentic and anonymous sources. Stored log data can be analyzed manually or with tools to identify and understand anomalous or negative activity and lead to intelligent remediations.

Enabling control plane logs, including API server audit logs for Amazon EKS clusters, significantly strengthens our security posture by providing detailed visibility into all API requests, thereby reducing our attack surface. By exporting these logs to a CloudWatch Log Group, we ensure persistent storage and facilitate both manual and automated analysis to quickly identify and remediate anomalous activities. While this configuration might slightly impact usability or performance due to the overhead of logging, the enhanced security and compliance benefits far outweigh these drawbacks, making it a critical component of our security strategy.

## Audit Procedure

**From Console:**

1. For each EKS Cluster in each region;
2. Go to 'Amazon EKS' > 'Clusters' > 'CLUSTER_NAME' > 'Configuration' > 'Logging'.
3. This will show the control plane logging configuration:

```
API server: Enabled / Disabled
Audit: Enabled / Disabled
Authenticator: Enabled / Disabled
Controller manager: Enabled / Disabled
Scheduler: Enabled / Disabled
```

4. Ensure that all options are set to 'Enabled'.

**From CLI:**

```bash
# For each EKS Cluster in each region;
export CLUSTER_NAME=<your cluster name>
export REGION_CODE=<your region_code>
aws eks describe-cluster --name ${CLUSTER_NAME} --region ${REGION_CODE} --query 'cluster.logging.clusterLogging'
```

## Remediation

**From Console:**

1. For each EKS Cluster in each region;
2. Go to 'Amazon EKS' > 'Clusters' > '' > 'Configuration' > 'Logging'.
3. Click 'Manage logging'.
4. Ensure that all options are toggled to 'Enabled'.

```
API server: Enabled
Audit: Enabled
Authenticator: Enabled
Controller manager: Enabled
Scheduler: Enabled
```

5. Click 'Save Changes'.

**From CLI:**

```bash
# For each EKS Cluster in each region;
aws eks update-cluster-config \
    --region '${REGION_CODE}' \
    --name '${CLUSTER_NAME}' \
    --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'
```

## Default Value

Control Plane Logging is disabled by default.

```
API server: Disabled
Audit: Disabled
Authenticator: Disabled
Controller manager: Disabled
Scheduler: Disabled
```

## References

1. [https://kubernetes.io/docs/tasks/debug-application-cluster/audit/](https://kubernetes.io/docs/tasks/debug-application-cluster/audit/)
2. [https://aws.github.io/aws-eks-best-practices/detective/](https://aws.github.io/aws-eks-best-practices/detective/)
3. [https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html](https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html)
4. [https://docs.aws.amazon.com/eks/latest/userguide/logging-using-cloudtrail.html](https://docs.aws.amazon.com/eks/latest/userguide/logging-using-cloudtrail.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process | X | X | X |
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |
| v7 | 6.3 Enable Detailed Logging | | X | X |
