---
name: cis-oke-v180-3.2.1
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, kubelet]
cis_id: "3.2.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.8.0 - Control 3.2.1

## Profile Applicability
- **Level:** 1

## Description
Disable anonymous requests to the Kubelet server.

## Rationale
When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the Kubelet server. You should rely on authentication to authorize access and disallow anonymous requests.

## Impact
Anonymous requests will be rejected.

## Audit Procedure

### Audit Method 1

If using a Kubelet configuration file, check that there is an entry for `authentication: anonymous: enabled` set to `false`.

First, SSH to the relevant node.

Run the following command on each node to find the appropriate Kubelet config file:

```bash
find / -name kubelet.service
```

The output of the above command should return the file and location `/etc/systemd/system/kublet.service` which is the location of the Kubelet service config file.

Open the Kubelet service config file:

```bash
sudo more etc/systemd/system/kubelet.service
```

Verify that the `--anonymous-auth=false`.

### Audit Method 2

If using the api configz endpoint consider searching for the status of `authentication... "anonymous":{"enabled":false}` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name:

```bash
HOSTNAME_PORT="localhost-and-port-number"
NODE_NAME="The-Name-Of-Node-To-Extract-Configuration" # from the output of "kubectl get nodes"
```

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=10.0.10.4 (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

## Remediation

### Remediation Method 1

If modifying the Kubelet service config file, edit the kubelet.service file `/etc/systemd/system/kubelet.service` and set the below parameter:

```
--anonymous-auth=false
```

### Remediation Method 2

If using the api configz endpoint consider searching for the status of `"authentication.*anonymous":{"enabled":false}` by extracting the live configuration from the nodes running kubelet.

See detailed step-by-step configmap procedures in [Reconfigure a Node's Kubelet in a Live Cluster](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/), and then rerun the curl statement from audit process to check for kubelet configuration changes.

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=10.0.10.4 (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

**For all remediations:** Based on your system, restart the `kubelet` service and check status:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value
See the OKE documentation for the default value.

## References
1. https://kubernetes.io/docs/admin/kubelet/
2. https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication
3. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1190, T1210 | TA0001, TA0008 | M1025 |

## Profile
**Level 1** (Automated)
