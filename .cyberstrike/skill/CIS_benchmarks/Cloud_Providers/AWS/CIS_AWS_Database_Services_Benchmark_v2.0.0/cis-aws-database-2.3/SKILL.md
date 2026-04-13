---
name: cis-aws-database-2.3
description: "Ensure Data in Transit Encryption is Enforced"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, encryption, tls, ssl, data-in-transit]
cis_id: "2.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.2]
prerequisites: []
severity_boost: {}
---

# 2.3 Ensure Data in Transit Encryption is Enforced (Manual)

## Description

Use TLS (Transport Layer Security) to secure data in transit. Aurora supports TLS-encrypted connections between your application and your DB instance, and this configuration can be enforced so non-TLS connections are prohibited.

## Rationale

Encrypting data in transit protects sensitive information from interception and tampering by unauthorized parties. Aurora supports TLS for securing client connections, however it is essential to ensure that client applications are properly configured to use TLS and that the database enforces encrypted connections.

## Impact

Disabling or failing to properly configure TLS can expose the data to be compromised by malicious actors, potentially resulting in data breaches, credential theft, or other security compromises.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console where the Aurora database cluster you are auditing resides.
2. Navigate to the Amazon Aurora and RDS Dashboard:
   - You can find this under the Database category.
3. Select the DB cluster name you wish to audit:
   - This opens the details page for your specific Aurora cluster.
4. Under Configuration, locate the DB cluster parameter group attached to this cluster:
   - Click on the parameter group name to review its parameters.
5. Verify the following engine-specific parameters to confirm encryption in transit is enforced:
   - **PostgreSQL:** Confirm that `rds.force_ssl = 1`
   - **MySQL:** Confirm that `require_secure_transport = ON` (Only applicable for Aurora MySQL versions 2 and 3)

**Notes:**

- Make sure the parameter changes are applied and the cluster has been rebooted if necessary for the parameters to take effect.

## Expected Result

- For PostgreSQL Aurora clusters: `rds.force_ssl` should be set to `1`
- For MySQL Aurora clusters: `require_secure_transport` should be set to `ON`

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console where the Aurora database cluster you are remediating resides.
2. Navigate to the Amazon Aurora and RDS Dashboard:
   - You can find this under the Database category.
3. Select the DB cluster name you wish to remediate:
   - This opens the details page for your specific Aurora cluster.
4. Under Configuration, locate the DB cluster parameter group attached to this cluster:
   - Click on the parameter group name to remediate its parameters.
5. Update the following engine-specific parameters to enforce encryption in transit at the database level:
   - **PostgreSQL:** Set `rds.force_ssl = 1`
   - **MySQL:** Set `require_secure_transport = ON` (applicable to Aurora MySQL versions 2 and 3 only).
6. Reboot the database cluster to apply the parameter changes.
7. Configure your client application for SSL/TLS connections:
   - Download the appropriate AWS-provided SSL/TLS certificates.

For MySQL-compatible Aurora, Amazon provides an SSL certificate that you can download from their documentation. PostgreSQL-compatible Aurora uses the default PostgreSQL SSL certificate.

Once you have the appropriate certificate, you must configure your client application to use SSL/TLS. For example, in MySQL, you might use a command like this:

```bash
mysql -h <myinstance.123456789012.us-east-1.rds.amazonaws.com> --ssl-ca=</path_to_certificate/rds-combined-ca-bundle.pem> --ssl-mode=VERIFY_IDENTITY
```

For PostgreSQL, you might use a command like this:

```bash
psql "host=<myinstance.123456789012.us-east-1.rds.amazonaws.com> sslmode=verify-ca sslrootcert=</path_to_certificate/rds-combined-ca-bundle.pem>"
```

Replace `<myinstance.123456789012.us-east-1.rds.amazonaws.com>` with the endpoint for your DB instance, and replace `</path_to_certificate/rds-combined-ca-bundle.pem>` with the path to the SSL certificate on your local machine.

8. **Verify Encryption** After configuring your client to use SSL/TLS, you should verify that encryption in transit is working correctly. You can do this by checking the status of the SSL connection from within the database itself. For example, in MySQL, you can run the following command:

```sql
SHOW STATUS LIKE 'Ssl_cipher';
```

In PostgreSQL, you can run the following command:

```sql
SHOW ssl;
```

In both cases, if SSL is enabled, you should see a non-empty cipher suite or on as a result.

## Default Value

Aurora supports TLS connections by default, but enforcement of TLS-only connections requires explicit configuration of the cluster parameter group.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit - Encrypt all sensitive information in transit.                                                                                |      | x    | x    |

## Profile

Level 1 | Manual
