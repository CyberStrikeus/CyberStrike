---
name: cis-azure-foundations-2.1.3
description: "Ensure traffic is encrypted between cluster worker nodes"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.8]
prerequisites: []
severity_boost: {}
---

# Ensure traffic is encrypted between cluster worker nodes

## Description

By default, data exchanged between worker nodes in an Azure Databricks cluster is not encrypted. To ensure that data is encrypted at all times, whether at rest or in transit, you can create an initialization script that configures your clusters to encrypt traffic between worker nodes using AES 256-bit encryption over a TLS 1.3 connection.

## Rationale

- Protects sensitive data during transit between cluster nodes, mitigating risks of data interception or unauthorized access.
- Aligns with organizational security policies and compliance requirements that mandate encryption of data in transit.
- Enhances overall security posture by ensuring that all inter-node communications within the cluster are encrypted.

## Impact

- Enabling encryption may introduce a performance penalty due to the computational overhead associated with encrypting and decrypting traffic. This can result in longer query execution times, especially for data-intensive operations.
- Implementing encryption requires creating and managing init scripts, which adds complexity to cluster configuration and maintenance.
- The shared encryption secret is derived from the hash of the keystore stored in DBFS. If the keystore is updated or rotated, all running clusters must be restarted to prevent authentication failures between Spark workers and drivers.

## Audit Procedure

### Audit from Azure Portal

Review cluster init scripts:

1. Navigate to your Azure Databricks workspace, go to the "Clusters" section, select a cluster, and check the "Advanced Options" for any init scripts that configure encryption settings.

Verify spark configuration:

2. Ensure that the following Spark configurations are set:

```
spark.authenticate true
spark.authenticate.enableSaslEncryption true
spark.network.crypto.enabled true
spark.network.crypto.keyLength 256
spark.network.crypto.keyFactoryAlgorithm PBKDF2WithHmacSHA1
spark.io.encryption.enabled true
```

These settings can be found in the cluster's Spark configuration properties.

Check keystore management:

3. Verify that the Java KeyStore (JKS) file is securely stored in DBFS and that its integrity is maintained.
4. Ensure that the keystore password is securely managed and not hardcoded in scripts.

## Expected Result

All cluster worker nodes should have inter-node encryption enabled with AES 256-bit over TLS 1.3. The Spark configuration should show the required encryption settings, and a valid JKS keystore should be present in DBFS.

## Remediation

Create a JKS keystore:

1. Generate a Java KeyStore (JKS) file that will be used for SSL/TLS encryption.
2. Upload the keystore file to a secure directory in DBFS (e.g. `/dbfs//jetty_ssl_driver_keystore.jks`).

Develop an init script:

3. Create an init script that performs the following tasks:
   - Retrieves the JKS keystore file and password.
   - Derives a shared encryption secret from the keystore.
   - Configures Spark driver and executor settings to enable encryption.

4. Example init script:

```bash
#!/bin/bash
set -euo pipefail
keystore_dbfs_file="/dbfs/<keystore-directory>/jetty_ssl_driver_keystore.jks"
max_attempts=30
while [ ! -f ${keystore_dbfs_file} ]; do
    if [ "$max_attempts" == 0 ]; then
        echo "ERROR: Unable to find the file : $keystore_dbfs_file. Failing the script."
        exit 1
    fi
    sleep 2s
    ((max_attempts--))
done
sasl_secret=$(sha256sum $keystore_dbfs_file | cut -d' ' -f1)
if [ -z "${sasl_secret}" ]; then
    echo "ERROR: Unable to derive the secret. Failing the script."
    exit 1
fi
local_keystore_file="$DB_HOME/keys/jetty_ssl_driver_keystore.jks"
local_keystore_password="gb1gQqZ9ZIHS"
if [[ $DB_IS_DRIVER = "TRUE" ]]; then
    driver_conf=${DB_HOME}/driver/conf/spark-branch.conf
    echo "Configuring driver conf at $driver_conf"
    if [ ! -e $driver_conf ]; then
        echo "spark.authenticate true" >> $driver_conf
        echo "spark.authenticate.secret $sasl_secret" >> $driver_conf
        echo "spark.authenticate.enableSaslEncryption true" >> $driver_conf
        echo "spark.network.crypto.enabled true" >> $driver_conf
        echo "spark.network.crypto.keyLength 256" >> $driver_conf
        echo "spark.network.crypto.keyFactoryAlgorithm PBKDF2WithHmacSHA1" >> $driver_conf
        echo "spark.io.encryption.enabled true" >> $driver_conf
        echo "spark.ssl.enabled true" >> $driver_conf
        echo "spark.ssl.keyPassword $local_keystore_password" >> $driver_conf
        echo "spark.ssl.keyStore $local_keystore_file" >> $driver_conf
        echo "spark.ssl.keyStorePassword $local_keystore_password" >> $driver_conf
        echo "spark.ssl.protocol TLSv1.3" >> $driver_conf
    fi
fi
executor_conf=${DB_HOME}/conf/spark.executor.extraJavaOptions
echo "Configuring executor conf at $executor_conf"
if [ ! -e $executor_conf ]; then
    echo "-Dspark.authenticate=true" >> $executor_conf
    echo "-Dspark.authenticate.secret=$sasl_secret" >> $executor_conf
    echo "-Dspark.authenticate.enableSaslEncryption=true" >> $executor_conf
    echo "-Dspark.network.crypto.enabled=true" >> $executor_conf
    echo "-Dspark.network.crypto.keyLength=256" >> $executor_conf
    echo "-Dspark.network.crypto.keyFactoryAlgorithm=PBKDF2WithHmacSHA1" >> $executor_conf
    echo "-Dspark.io.encryption.enabled=true" >> $executor_conf
    echo "-Dspark.ssl.enabled=true" >> $executor_conf
    echo "-Dspark.ssl.keyPassword=$local_keystore_password" >> $executor_conf
    echo "-Dspark.ssl.keyStore=$local_keystore_file" >> $executor_conf
    echo "-Dspark.ssl.keyStorePassword=$local_keystore_password" >> $executor_conf
    echo "-Dspark.ssl.protocol=TLSv1.3" >> $executor_conf
fi
```

5. Save the init script and attach it to the cluster configuration.

## Default Value

By default, traffic is not encrypted between cluster worker nodes.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/security/keys/encrypt-otw

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## Profile

Level 2 | Manual
