---
name: cis-gke-v180-5.7.2
description: "Enable Linux auditd logging (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, logging, cloud-monitoring, stackdriver, auditd]
cis_id: "5.7.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.7.2 Enable Linux auditd logging (Manual)

## Profile Applicability

- Level 2

## Description

Run the auditd logging daemon to obtain verbose operating system logs from GKE nodes running Container-Optimized OS (COS).

## Rationale

Auditd logs provide valuable information about the state of the cluster and workloads, such as error messages, login attempts, and binary executions. This information can be used to debug issues or to investigate security incidents.

## Impact

Increased logging activity on a node increases resource usage on that node, which may affect the performance of the workload and may incur additional resource costs. Audit logs sent to Stackdriver consume log quota from the project. The log quota may require increasing and storage to accommodate the additional logs.

Note that the provided logging daemonset only works on nodes running Container-Optimized OS (COS).

## Audit

Using Google Cloud Console

1. Navigate to the Kubernetes Engine workloads by visiting: https://console.cloud.google.com/kubernetes/workload.
2. Observe the workloads and ensure that all filters are removed.
3. If the unmodified example auditd logging daemonset: https://raw.githubusercontent.com/GoogleCloudPlatform/k8s-node-tools/master/os-audit/cos-auditd-logging.yaml is being used, ensure that the `cos-auditd-logging` daemonset is being run in the `cos-auditd` namespace with the number of running pods reporting as expected.

Using Command Line:
If using the unmodified example auditd logging daemonset, run:

```
kubectl get daemonsets -n cos-audit
```

and observe that the `cos-auditd-logging` daemonset is running as expected.
If the name or namespace of the daemonset has been modified and is unknown, search for the container being used by the daemonset:

```
kubectl get daemonsets -A -o json | jq '.items[] | select (.spec.template.spec.containers[].image | contains ("gcr.io/stackdriver-agents/stackdriver-logging-agent"))'| jq '{name: .metadata.name, annotations: .metadata.annotations."kubernetes.io/description", namespace: .metadata.namespace, status: .status}'
```

The above command returns the name, namespace and status of the daemonsets that use the Stackdriver logging agent. The example auditd logging daemonset has a description within the annotation as output by the command above:

```json
{
  "name": "cos-auditd-logging",
  "annotations": "DaemonSet that enables Linux auditd logging on COS nodes.",
  "namespace": "cos-auditd",
  "status": {...
  }
}
```

Ensure that the status fields return that the daemonset is running as expected.

## Remediation

Using Command Line:
Download the example manifests:

```
curl https://raw.githubusercontent.com/GoogleCloudPlatform/k8s-node-tools/master/os-audit/cos-auditd-logging.yaml > cos-auditd-logging.yaml
```

Edit the example manifests if needed. Then, deploy them:

```
kubectl apply -f cos-auditd-logging.yaml
```

Verify that the logging Pods have started. If a different Namespace was defined in the manifests, replace `cos-auditd` with the name of the namespace being used:

```
kubectl get pods --namespace=cos-auditd
```

## Default Value

By default, the auditd logging daemonset is not launched when a GKE cluster is created.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/linux-auditd-logging
2. https://cloud.google.com/container-optimized-os/docs

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |
