---
name: cis-aws-foundations-2.17
description: "Ensure that all expired SSL/TLS certificates stored in AWS IAM are removed"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, ssl, tls, certificates, expired-certificates, acm]
cis_id: "2.17"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.18]
prerequisites: []
severity_boost: {}
---

# Ensure that all expired SSL/TLS certificates stored in AWS IAM are removed

## Description
To enable HTTPS connections to your website or application in AWS, you need an SSL/TLS server certificate. You should use AWS Certificate Manager (ACM) to store and deploy server certificates, as storing certificates in IAM is no longer recommended. Use IAM only when you must support HTTPS connections in a region or service that is not supported by ACM. IAM securely encrypts your private keys and stores the encrypted version in IAM SSL certificate storage. IAM supports deploying server certificates in all regions, but you must obtain your certificate from an external provider for use with AWS. You cannot upload an ACM certificate to IAM. Additionally, you cannot manage your certificates from the IAM Console.

## Rationale
Removing expired SSL/TLS certificates eliminates the risk that an invalid certificate will be deployed accidentally to a resource such as AWS Elastic Load Balancer (ELB), which can damage the credibility of the application or website behind the ELB. As a best practice, it is recommended to delete expired certificates and migrate certificate management to AWS Certificate Manager (ACM) where supported.

## Impact
Deleting certificates may impact applications if expired certificates are still in use by services such as Elastic Load Balancing or CloudFront. Ensure services are updated to use valid certificates before removal. Migrating certificates from IAM to ACM may require updates to associated resources.

## Audit Procedure

### Using AWS Console
Getting certificate expiration information via the AWS Management Console is not currently supported for IAM-stored certificates. To request information about SSL/TLS certificates stored in IAM, use the Command Line Interface (CLI).

### Using AWS CLI

1. Run the following command to list all IAM-stored server certificates:

```bash
aws iam list-server-certificates
```

2. The command output returns an array containing all SSL/TLS certificates and their metadata:

```json
{
  "ServerCertificateMetadataList": [
    {
      "ServerCertificateId": "EHDGFRW7EJFYTE88D",
      "ServerCertificateName": "MyServerCertificate",
      "Expiration": "2018-07-10T23:59:59Z",
      "Path": "/",
      "Arn": "arn:aws:iam::012345678910:server-certificate/MySSLCertificate",
      "UploadDate": "2018-06-10T11:56:08Z"
    }
  ]
}
```

3. Review the `Expiration` value for each certificate and determine if any certificates are expired
4. If expired certificates are identified, they should be removed
5. If the command returns:

```json
{ "ServerCertificateMetadataList": [] }
```

This indicates that no certificates are currently stored in IAM

## Expected Result
No expired SSL/TLS certificates should be stored in AWS IAM. The `ServerCertificateMetadataList` should either be empty or contain only certificates with `Expiration` dates in the future.

## Remediation

### Using AWS Console
Removing expired certificates via the AWS Management Console is not currently supported. Use the CLI to delete IAM-stored certificates.

### Using AWS CLI

1. Run the following command to delete an expired certificate:

```bash
aws iam delete-server-certificate --server-certificate-name <CERTIFICATE_NAME>
```

2. A successful command returns no output

## Default Value
By default, expired SSL/TLS certificates stored in AWS IAM are not automatically deleted. Certificates remain in IAM until manually removed. ACM-managed certificates are automatically renewed when possible.

## References
1. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_server-certs.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/iam/delete-server-certificate.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.1 Establish and Maintain a Data Management Process - Establish and maintain a data management process. In the process, address data sensitivity, data owner, handling of data, data retention limits, and disposal requirements, based on sensitivity and retention standards for the enterprise. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | x | x | x |
| v7 | 13.1 Maintain an Inventory Sensitive Information - Maintain an inventory of all sensitive information stored, processed, or transmitted by the organization's technology systems, including those located onsite or at a remote service provider. | x | x | x |

## Profile
Level 1 | Automated
