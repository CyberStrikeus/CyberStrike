---
name: cis-oke-v170-3.2.3
description: "Ensure that the --client-ca-file argument is set as appropriate (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, kubelet]
cis_id: "3.2.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 3.2.3

## Profile Applicability
- **Level:** 1

## Description
Enable Kubelet authentication using certificates.

## Rationale
The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the apiserver does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks. Enabling Kubelet certificate authentication ensures that the apiserver could authenticate the Kubelet before submitting any requests.

## Impact
You require TLS to be configured on apiserver as well as kubelets.

## Audit Procedure

### Audit Method 1

If using a Kubelet configuration file, check that there is an entry for `--client-ca-file` set to the location of the client certificate authority file.

First, SSH to the relevant node.

Run the following command on each node to find the appropriate Kubelet config file:

```bash
find / -name kubelet.service
```

The output of the above command should return the file and location `/etc/systemd/system/kublet.service` which is the location of the Kubelet service config file.

Open the Kubelet service config file:

```bash
sudo more etc/systemd/system/kublet.service
```

Verify that the `--client-ca-file` argument exists and is set to the location of the client certificate authority file.

### Audit Method 2

If using the api configz endpoint consider searching for the status of `authentication..x509":{"clientCAFile":"/etc/kubernetes/ca.crt` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name;

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
--client-ca-file=/etc/kubernetes/ca.crt \
```

### Remediation Method 2

If using the api configz endpoint consider searching for the status of `"authentication.*x509":{"clientCAFile":"/etc/kubernetes/pki/ca.crt"` by extracting the live configuration from the nodes running kubelet.

**See detailed step-by-step configmap procedures in [Reconfigure a Node's Kubelet in a Live Cluster](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/), and then rerun the curl statement from audit process to check for kubelet configuration changes

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
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/
3. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | * | * |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Automated)
