---
name: cis-oke-v170-3.1.2
description: "Ensure that the kubelet-config.json file ownership is set to root:root (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, config-files]
cis_id: "3.1.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 3.1.2

## Profile Applicability
- **Level:** 1

## Description
If `kubelet` is running, ensure that the file ownership of its kubelet-config.json file is set to `root:root`.

## Rationale
The kubelet-config.json file for `kubelet` controls various parameters for the `kubelet` service in the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact
None

## Audit Procedure

### Method 1

SSH to the worker nodes. To check to see if the Kubelet Service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.

Run the following command on each node to find the appropriate kubelet-config.json file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--kubeconfig /etc/kubernetes/kubelet-config.json` which is the location of the kubelet-config.json file.

Run this command to obtain the kubelet-config.json file ownership:

```bash
stat -c %U:%G /etc/kubernetes/kubelet-config.json
```

The output of the above command gives you the kubelet-config.json file's ownership. Verify that the ownership is set to `root:root`.

### Method 2

Create and Run a Privileged Pod. You will need to run a pod that is privileged enough to access the host's file system. This can be achieved by deploying a pod that uses the hostPath volume to mount the node's file system into the pod.

Here's an example of a simple pod definition that mounts the root of the host to /host within the pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: file-check
spec:
  volumes:
  - name: host-root
    hostPath:
      path: /
      type: Directory
  containers:
  - name: nsenter
    image: busybox
    command: ["sleep", "3600"]
    volumeMounts:
    - name: host-root
      mountPath: /host
    securityContext:
      privileged: true
```

Save this to a file (e.g., file-check-pod.yaml) and create the pod:

```bash
kubectl apply -f file-check-pod.yaml
```

Once the pod is running, you can exec into it to check file ownership on the node:

```bash
kubectl exec -it file-check -- sh
```

Now you are in a shell inside the pod, but you can access the node's file system through the /host directory and check the ownership of the file:

```bash
ls -l /host/etc/kubernetes/kubelet-config.json
```

Verify that the ownership is set to `root:root`.

## Remediation
Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chown root:root <kubelet-config.json file>
```

## Default Value
See the OKE documentation for the default value.

## References
1. https://kubernetes.io/docs/admin/kube-proxy/
2. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |
| v6 | 5.1 Minimize And Sparingly Use Administrative Privileges | | | |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1083, T1222 | TA0005, TA0007 | M1026 |

## Profile
**Level 1** (Automated)
