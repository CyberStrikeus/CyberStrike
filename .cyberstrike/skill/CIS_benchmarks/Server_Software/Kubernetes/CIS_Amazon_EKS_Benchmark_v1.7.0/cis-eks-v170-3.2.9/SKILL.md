---
name: cis-eks-v170-3.2.9
description: "Ensure that the RotateKubeletServerCertificate argument is set to true (Automated)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, worker-node, kubelet, certificates, rotation, tls, server-certificate]
cis_id: "3.2.9"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.9 Ensure that the RotateKubeletServerCertificate argument is set to true (Automated)

## Profile Applicability

- Level 1

## Description

Enable kubelet server certificate rotation.

## Rationale

`RotateKubeletServerCertificate` causes the kubelet to both request a serving certificate after bootstrapping its client credentials and rotate the certificate as its existing credentials expire. This automated periodic rotation ensures that the there are no downtimes due to expired certificates and thus addressing availability in the CIA (Confidentiality, Integrity, and Availability) security triad.

Note: This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to implement rotation yourself.

## Audit Procedure

**Audit Method 1:**

First, SSH to each node. Run the following command to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

If the output of the command above includes the `--rotate-kubelet-server-certificate` executable argument verify that it is set to true.

If the process does not have the `--rotate-kubelet-server-certificate` executable argument then check the Kubelet config file. The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/kubelet-config.json` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet/kubelet-config.json
```

Verify that the `RotateKubeletServerCertificate` argument is set to `true`.

## Remediation

**Remediation Method 1:**

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to true:

```json
"RotateKubeletServerCertificate":true
```

Additionally, ensure that the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` does not set the `--RotateKubeletServerCertificate` executable argument to false because this would override the Kubelet config file.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--RotateKubeletServerCertificate=true
```

## Default Value

See the Amazon EKS documentation for the default value.

## References

1. [https://github.com/kubernetes/kubernetes/pull/41912](https://github.com/kubernetes/kubernetes/pull/41912)
2. [https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration)
3. [https://kubernetes.io/docs/imported/release/notes/](https://kubernetes.io/docs/imported/release/notes/)
4. [https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/)
5. [https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/)

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |
