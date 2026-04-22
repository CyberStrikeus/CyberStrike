---
name: cis-oke-v150-3.1.1
description: "Ensure that the oke_kubelet_conf.json file permissions are set to 644 or more restrictive (Automated)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, configuration-files, permissions]
cis_id: "3.1.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1 Ensure that the oke_kubelet_conf.json file permissions are set to 644 or more restrictive (Automated)

## Profile Applicability

- Level 1

## Description

If `kubelet` is running, and if it is using a file-based oke_kubelet_conf.json file, ensure that the proxy oke_kubelet_conf.json file has permissions of `644` or more restrictive.

## Rationale

The `kubelet` oke_kubelet_conf.json file controls various parameters of the `kubelet` service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

It is possible to run `kubelet` with the kubeconfig parameters configured as a Kubernetes ConfigMap instead of a file. In this case, there is no proxy oke_kubelet_conf.json file.

## Impact

None.

## Audit Procedure

**Method 1**
SSH to the worker nodes
To check to see if the Kubelet Service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.
Run the following command on each node to find the appropriate oke_kubelet_conf.json file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--kubeconfig /var/lib/kubelet/oke_kubelet_conf.json` which is the location of the oke_kubelet_conf.json file.
Run this command to obtain the oke_kubelet_conf.json file permissions:

```bash
stat -c %a /var/lib/kubelet/oke_kubelet_conf.json
```

The output of the above command gives you the oke_kubelet_conf.json file's permissions.
Verify that if a file is specified and it exists, the permissions are `644` or more restrictive.

**Method 2**
Create and Run a Privileged Pod.
You will need to run a pod that is privileged enough to access the host's file system. This can be achieved by deploying a pod that uses the hostPath volume to mount the node's file system into the pod.
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

Once the pod is running, you can exec into it to check file permissions on the node:

```bash
kubectl exec -it file-check -- sh
```

Now you are in a shell inside the pod, but you can access the node's file system through the /host directory and check the permission level of the file:

```bash
ls -l /host/var/lib/kubelet/oke_kubelet_conf.json
```

Verify that if a file is specified and it exists, the permissions are `644` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chmod 644 <oke_kubelet_conf.json file>
```

## Default Value

See the OKE documentation for the default value.

## References

1. [https://kubernetes.io/docs/admin/kube-proxy/](https://kubernetes.io/docs/admin/kube-proxy/)
2. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1022 |

---

**Profile:** Level 1 - CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0
