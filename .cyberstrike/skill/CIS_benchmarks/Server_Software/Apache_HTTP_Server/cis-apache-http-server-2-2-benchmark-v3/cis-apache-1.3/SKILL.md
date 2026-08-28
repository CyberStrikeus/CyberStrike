---
name: cis-apache-1.3
description: "Ensure Apache Is Installed From the Appropriate Binaries"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Apache Is Installed From the Appropriate Binaries

## Description

The CIS Apache Benchmark recommends using the Apache binary provided by your vendor for most situations in order to reduce the effort and increase the effectiveness of maintenance and security patches. However, to keep the benchmark as generic and applicable to all Unix/Linux platforms as possible, a default source build has been used for this benchmark.

**Important Note**: There is a major difference between source builds and most vendor packages that is very important to highlight. The default source build of Apache is fairly conservative and minimalist in the modules included, and therefore starts off in a fairly strong security state, while most vendor binaries are typically very well loaded with most of the functionality that one may be looking for. _Therefore, it is important that you don't assume the default value shown in the benchmark will match default values in your installation._ You should always test any new installation in your environment before putting it into production. Also, keep in mind you can install and run a new version alongside the old one by using a different Apache prefix and a different IP address or port number in the `Listen` directive.

## Rationale

The benefits of using vendor supplied binaries include:

- Easy installation; it should work straight out of the box.
- It is customized for your OS environment.
- It has been tested and gone through QA procedures.
- Everything you need is likely to be included, probably including some third-party modules. Many OS vendors ship Apache with mod_ssl, OpenSSL, PHP, mod_perl and mod_security, for example.
- Your vendor will tell you about security issues, so you have to look for information in fewer places.
- Updates to fix security issues will be easy to apply. The vendor will have already verified the problem, checked the signature on the Apache download, worked out the impact, and so on.
- You may be able to get the updates automatically, reducing the window of risk.

## Impact

None documented

## Audit Procedure

Verify the installation method used for Apache HTTP Server on your system.

For vendor binaries, verify the package is installed through the OS package manager:

```bash
# Red Hat/CentOS
rpm -qa | grep httpd

# Debian/Ubuntu
dpkg -l | grep apache2
```

For source builds, verify the installation directory and compilation options:

```bash
httpd -V
```

## Remediation

Installation depends on the operating system platform. For a source build, consult the Apache 2.2 documentation on compiling and installing http://httpd.apache.org/docs/2.2/install.html. For Red Hat Enterprise Linux 5, the following yum command could be used:

```bash
# yum install httpd
```

## Default Value

No default installation method - varies by organization and requirements.

## References

1. Apache Compiling and Installation http://httpd.apache.org/docs/2.2/install.html

## CIS Controls

Version 6

2 Inventory of Authorized and Unauthorized Software
Inventory of Authorized and Unauthorized Software

Version 7

2.1 Maintain Inventory of Authorized Software
Maintain an up-to-date list of all authorized software that is required in the enterprise for any business purpose on any business system.

2.2 Ensure Software is Supported by Vendor
Ensure that only software applications or operating systems currently supported by the software's vendor are added to the organization's authorized software inventory. Unsupported software should be tagged as unsupported in the inventory system.

## Profile

Level 1 | Not Scored
Level 2 | Not Scored
