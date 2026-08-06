---
name: cloud-assessment
description: Multi-cloud READ-ONLY security assessment methodology for AWS, Azure, and GCP using CIS benchmark-aligned checks
category: assessment
tags: [cloud, aws, azure, gcp, security-audit, cis-benchmark, iam, storage, network, encryption, logging, dns, tls]
tech_stack: [aws, azure, gcp, aws-cli, az-cli, gcloud-cli]
cwe_ids: [CWE-269, CWE-311, CWE-319, CWE-693, CWE-778]
version: "1.0"
---

# Cloud Security Assessment Methodology

Multi-cloud READ-ONLY security assessment using the `cloud_audit` tool. All checks use describe/list/get CLI calls via native TypeScript — no Python dependency, no SDK imports. Uses aws/az/gcloud CLIs. Aligned with CIS benchmarks for AWS, Azure, and GCP.

## Safety First

**ALWAYS run `verify_readonly` before any other audit program.** This confirms the current credentials have no dangerous write permissions. If the check returns FAIL, stop and request read-only credentials.

```
cloud_audit verify_readonly --provider all
```

## Assessment Phases

### Phase 1 — Credential Safety Verification

| Check | Command | Purpose |
|-------|---------|---------|
| Verify read-only | `cloud_audit verify_readonly --provider all` | Confirm no write permissions — MUST pass before proceeding |

### Phase 2 — Identity & Access Management

IAM is the most critical attack surface in cloud environments.

| Provider | Command | Key Checks |
|----------|---------|------------|
| AWS | `cloud_audit aws_iam_audit --json-output` | MFA status, wildcard policies, unused keys, cross-account trust, root access keys |
| Azure | `cloud_audit azure_iam_audit --json-output` | Dangerous role assignments (Owner/Contributor), subscription-level owners, wildcard custom roles |
| GCP | `cloud_audit gcp_iam_audit --json-output` | Primitive roles (Owner/Editor at project), SA key age >90d, domain-wide delegation |

**Intelligence integration:** After IAM audit, report findings via `add_intel` with type `infrastructure`:
```
add_intel type=infrastructure data="IAM audit: 3 users without MFA, 2 wildcard policies found"
```

### Phase 3 — Storage Security

Public storage buckets are the #1 cloud data breach vector.

| Provider | Command | Key Checks |
|----------|---------|------------|
| AWS | `cloud_audit aws_storage_audit --json-output` | S3 Block Public Access, ACLs, default encryption, versioning, access logging |
| Azure | `cloud_audit azure_storage_audit --json-output` | Blob public access, HTTPS-only, minimum TLS version, SAS policies |
| GCP | `cloud_audit gcp_storage_audit --json-output` | allUsers/allAuthenticatedUsers bindings, uniform bucket-level access, versioning |

### Phase 4 — Network Security

Open security groups and missing flow logs are common misconfigurations.

| Provider | Command | Key Checks |
|----------|---------|------------|
| AWS | `cloud_audit aws_network_audit --json-output` | SGs open to 0.0.0.0/0 on dangerous ports, IMDSv1, VPC flow logs |
| Azure | `cloud_audit azure_network_audit --json-output` | NSG Any/Any rules, public IPs on VMs, NSG flow logs |
| GCP | `cloud_audit gcp_network_audit --json-output` | Firewall rules open to 0.0.0.0/0, external IPs, legacy networks |

### Phase 5 — Encryption at Rest

Unencrypted storage is a compliance violation in most frameworks.

| Provider | Command | Key Checks |
|----------|---------|------------|
| AWS | `cloud_audit aws_encryption_audit --json-output` | EBS/RDS encryption, KMS key rotation, CMK vs AWS-managed |
| Azure | `cloud_audit azure_encryption_audit --json-output` | Disk encryption, storage CMK, Key Vault rotation |
| GCP | `cloud_audit gcp_encryption_audit --json-output` | Disk/SQL/GCS CMEK, KMS key rotation |

### Phase 6 — Logging & Monitoring

Missing audit logs mean attacks go undetected.

| Provider | Command | Key Checks |
|----------|---------|------------|
| AWS | `cloud_audit aws_logging_audit --json-output` | CloudTrail multi-region, GuardDuty, Config recorder |
| Azure | `cloud_audit azure_logging_audit --json-output` | Activity Log retention, Diagnostic settings, Defender status |
| GCP | `cloud_audit gcp_logging_audit --json-output` | Audit log config (DATA_READ/DATA_WRITE), log sinks, filters |

### Phase 7 — DNS & TLS

External-facing services need DNS security and valid TLS.

| Check | Command | Key Checks |
|-------|---------|------------|
| DNS | `cloud_audit dns_audit --domain TARGET` | Dangling CNAMEs (subdomain takeover), DNSSEC, CAA records |
| TLS | `cloud_audit tls_audit --target HOST:PORT` | Protocol version, certificate expiry, cipher strength, HSTS |

## Vulnerability Reporting

For each FAIL finding, report via `report_vulnerability`:

```
report_vulnerability
  title: "AWS IAM user without MFA: admin-user"
  severity: high
  evidence:
    requestSent: "cloud_audit aws_iam_audit --json-output"
    responseCode: 0
    responseSummary: "checkId AWS-IAM-001 FAIL — user admin-user has console access without MFA"
    reasoning: "CIS AWS 1.10 requires MFA for all IAM users with console access"
```

## Coverage Notes

Use `record_coverage_note` with `scope: "wide"` for account-level findings:
```
record_coverage_note
  scope: wide
  note: "AWS IAM audit complete — 5 findings across 12 users. No root access keys detected."
```

## Program Reference

| Program | Domain | Providers |
|---------|--------|-----------|
| verify_readonly | Safety | AWS, Azure, GCP |
| aws_iam_audit | IAM | AWS |
| azure_iam_audit | IAM | Azure |
| gcp_iam_audit | IAM | GCP |
| aws_storage_audit | Storage | AWS |
| azure_storage_audit | Storage | Azure |
| gcp_storage_audit | Storage | GCP |
| aws_network_audit | Network | AWS |
| azure_network_audit | Network | Azure |
| gcp_network_audit | Network | GCP |
| aws_encryption_audit | Encryption | AWS |
| azure_encryption_audit | Encryption | Azure |
| gcp_encryption_audit | Encryption | GCP |
| aws_logging_audit | Logging | AWS |
| azure_logging_audit | Logging | Azure |
| gcp_logging_audit | Logging | GCP |
| dns_audit | DNS | Cross-cloud |
| tls_audit | TLS | Cross-cloud |
