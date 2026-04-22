---
name: cis-oke-v180-3.2.8
description: "Ensure that the --tls-cert-file and --tls-private-key-file arguments are set as appropriate (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, kubelet]
cis_id: "3.2.8"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.8.0 - Control 3.2.8

## Profile Applicability
- **Level:** 1

## Description
Setup TLS connection on the Kubelets.

## Rationale
Kubelet communication contains sensitive parameters that should remain encrypted in transit. Configure the Kubelets to serve only HTTPS traffic.

## Impact
TLS and client certificate authentication must be configured for your Kubernetes cluster deployment.

## Audit Procedure

### Audit Method 1

If using a Kubelet configuration file, check that there is an entry for `tls-cert-file` set to `correct pem file` and `tls-private-key-file` is set to `correct key file`.

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

Verify that the `tls-cert-file=/var/lib/kubelet/pki/tls.pem`. Verify that the `tls-private-key-file=/var/lib/kubelet/pki/tls.key`.

### Audit Method 2

If using the api configz endpoint consider searching for the status of `tlsCertFile` and `tlsPrivateKeyFile` are set by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name:

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
Verify that the `tls-cert-file=/var/lib/kubelet/pki/tls.pem`.
Verify that the `tls-private-key-file=/var/lib/kubelet/pki/tls.key`.
```

### Remediation Method 2

If using the api configz endpoint consider searching for the status of `tlsCertFile` and `tlsPrivateKeyFile` are set by extracting the live configuration from the nodes running kubelet.

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
2. http://rootsquash.com/2016/05/10/securing-the-kubernetes-api/
3. https://github.com/kelseyhightower/docker-kubernetes-tls-guide
4. https://jvns.ca/blog/2017/08/05/how-kubernetes-certificates-work/
5. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | * | * |
| v7 | 14.3 Disable Workstation to Workstation Communication | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078, T1552 | TA0001, TA0006 | M1035, M1041 |

## Profile
**Level 1** (Automated)
