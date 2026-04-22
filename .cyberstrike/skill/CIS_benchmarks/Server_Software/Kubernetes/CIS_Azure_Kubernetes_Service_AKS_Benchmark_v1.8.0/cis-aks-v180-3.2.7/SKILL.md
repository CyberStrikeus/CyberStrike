---
name: cis-aks-v180-3.2.7
description: "Ensure that the --eventRecordQPS argument is set to 0 or a level which ensures appropriate event capture (Automated)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, kubelet, event-recording, logging]
cis_id: "3.2.7"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.7 Ensure that the --eventRecordQPS argument is set to 0 or a level which ensures appropriate event capture (Automated)

## Profile Applicability

- Level 2

## Description

Security relevant information should be captured. The `--eventRecordQPS` flag on the Kubelet can be used to limit the rate at which events are gathered. Setting this too low could result in relevant events not being logged, however the unlimited setting of `0` could result in a denial of service on the kubelet.

## Rationale

It is important to capture all events and not restrict event creation. Events are an important source of security information and analytics that ensure your environment is consistently monitored using the event data.

## Impact

Setting this parameter to `0` could result in a denial of service condition due to excessive events being created. The cluster's event processing and storage systems should be scaled to handle expected event loads.

## Audit Procedure

**Audit Method 1:**

First, SSH to each node.

Run the following command on each node to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

In the output of the above command review the value set for the `--eventRecordQPS` argument and determine whether this has been set to an appropriate level for the cluster. The value of `0` can be used to ensure that all events are captured.

If the `--eventRecordQPS` argument does not exist, check that there is a Kubelet config file specified by `--config` and review the value in this location. The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/kubelet-config.json` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet/kubelet-config.json
```

If there is an entry for `eventRecordQPS` check that it is set to 0 or an appropriate level for the cluster.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `eventRecordQPS` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name; `HOSTNAME_PORT="localhost-and-port-number"` `NODE_NAME="The-Name-Of-Node-To-Extract-Configuration"` from the output of `kubectl get nodes`

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=ip-192.168.31.226.aks.internal (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

## Remediation

**Remediation Method 1:**

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to 5 or a value greater or equal to 0:

```json
"eventRecordQPS": 5
```

Check that `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` does not define an executable argument for `eventRecordQPS` because this would override your Kubelet config.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--eventRecordQPS=5
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"eventRecordQPS"` by extracting the live configuration from the nodes running kubelet.

**See detailed step-by-step configmap procedures in [Reconfigure a Node's Kubelet in a Live Cluster](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/), and then rerun the curl statement from audit process to check for kubelet configuration changes.

**For all three remediations:** Based on your system, restart the `kubelet` service and check status:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the AKS documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kubelet/
2. https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/apis/kubeletconfig/v1beta1/types.go
3. https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/
4. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-logging-threat-detection

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v8 | 8.5 Collect Detailed Audit Logs | | X | X |
| v7 | 6 Maintenance, Monitoring and Analysis of Audit Logs | | | |
