---
name: k8s-assessment
description: READ-ONLY Kubernetes security assessment based on CIS Kubernetes Benchmark using kubectl
category: security-assessment
tags: [kubernetes, k8s, cis-benchmark, rbac, network-policy, pod-security, secrets, ingress, security-audit]
tech_stack: [kubernetes, kubectl]
cwe_ids: [CWE-269, CWE-284, CWE-311, CWE-732, CWE-693]
chains_with: [T1613, T1087.004, T1078.004]
prerequisites: [kubectl-access]
version: "1.0"
---

# Kubernetes Security Assessment Methodology

READ-ONLY Kubernetes security assessment using kubectl CLI. No resources are created, modified, or deleted — all checks use get/list/describe/auth can-i verbs only. Based on CIS Kubernetes Benchmark v1.8+.

## Prerequisites

1. **kubectl installed** — `kubectl version --client`
2. **kubeconfig with read access** — cluster-viewer or equivalent ClusterRole
3. **Verify read-only** — ALWAYS run `k8s_audit verify_readonly` first

```bash
# Quick prerequisite check
kubectl version --client     # verify kubectl
kubectl cluster-info         # verify cluster access
kubectl auth can-i list pods --all-namespaces  # verify read access
```

## Assessment Phases

### Phase 0 — Safety Check (MANDATORY FIRST STEP)

```
k8s_audit verify_readonly
```

Confirms current identity has no write/modify/delete permissions via kubectl auth can-i. If write permissions are detected, STOP and request a read-only kubeconfig.

### Phase 1 — RBAC Analysis

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| cluster-admin bindings | `k8s_audit rbac_audit` | 5.1.1 |
| Wildcard ClusterRoles | `k8s_audit rbac_audit` | 5.1.3 |
| Default SA permissions | `k8s_audit rbac_audit --namespace NS` | 5.1.5 |

### Phase 2 — Pod Security

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| Privileged containers | `k8s_audit pod_security_audit` | 5.2.1 |
| hostPID / hostNetwork | `k8s_audit pod_security_audit` | 5.2.2, 5.2.3 |
| Dangerous capabilities | `k8s_audit pod_security_audit` | 5.2.7-9 |
| Root execution | `k8s_audit pod_security_audit` | 5.2.6 |
| hostPath mounts | `k8s_audit pod_security_audit` | 5.2.13 |

### Phase 3 — Network Security

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| Missing NetworkPolicies | `k8s_audit network_policy_audit` | 5.3.2 |
| Default deny policies | `k8s_audit network_policy_audit` | 5.3.2 |
| Ingress TLS | `k8s_audit ingress_audit` | — |
| Ingress snippet injection | `k8s_audit ingress_audit` | — |

### Phase 4 — Secrets & Encryption

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| Secret types & counts | `k8s_audit secrets_audit` | 5.4.1 |
| Secrets as env vars | `k8s_audit secrets_audit` | 5.4.1 |
| etcd encryption | `k8s_audit secrets_audit` | 1.2.29-30 |

### Phase 5 — API Server & Infrastructure

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| Anonymous auth | `k8s_audit api_server_audit` | 1.2.1 |
| Insecure port | `k8s_audit api_server_audit` | 1.2.19 |
| Admission controllers | `k8s_audit api_server_audit` | 1.2.11-16 |
| Audit logging | `k8s_audit api_server_audit` | 1.2.17-18 |

### Phase 6 — Workload Hardening

| Check | Command | CIS Benchmark |
|-------|---------|---------------|
| Resource limits | `k8s_audit resource_limits_audit` | 5.4.1 |
| LimitRange/ResourceQuota | `k8s_audit resource_limits_audit` | — |
| Image tags | `k8s_audit image_audit` | — |
| Untrusted registries | `k8s_audit image_audit` | — |
| SA auto-mount tokens | `k8s_audit serviceaccount_audit` | 5.1.5-6 |

## Program Reference

| Program | Checks | CIS Section |
|---------|--------|-------------|
| verify_readonly | Write permission detection | — |
| rbac_audit | cluster-admin, wildcards, default SA | 5.1.x |
| network_policy_audit | Missing policies, default deny | 5.3.x |
| pod_security_audit | Privileged, hostPID, capabilities, root | 5.2.x |
| secrets_audit | Secret types, env exposure, etcd encryption | 1.2.29, 5.4.x |
| image_audit | Latest tags, pull policy, untrusted registries | — |
| api_server_audit | Anonymous auth, insecure port, admission, audit | 1.2.x |
| resource_limits_audit | CPU/memory limits, LimitRange, ResourceQuota | 5.4.x |
| ingress_audit | TLS, wildcard hosts, snippet injection | — |
| serviceaccount_audit | Auto-mount tokens, cluster-admin SAs, unused SAs | 5.1.x |
