---
name: cis-apache24-4.1
description: "Ensure Access to OS Root Directory Is Denied By Default"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, access-control]
cis_id: "4.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure Access to OS Root Directory Is Denied By Default

## Profile Applicability
- Level 1

## Description

The Apache `Directory` directive allows for directory specific configuration of access controls and many other features and options. One important usage is to create a default deny policy that does not allow access to operating system directories and files, except for those specifically allowed. This is done by denying access to the OS root directory.

## Rationale

One aspect of Apache, which is occasionally misunderstood, is the feature of default access. That is, unless you take steps to change it, if the server can find its way to a file through normal URL mapping rules, it can and will serve it to clients. Having a default deny is a predominate security principle, and then helps prevent the unintended access, and we do that in this case by denying access to the OS root directory using either of two methods but not both:

1. Using the Apache `Deny` directive along with an `Order` directive.
2. Using the Apache `Require` directive.

Either method is effective. The `Order/Deny/Allow` combination are now deprecated; they provide three passes where all the directives are processed in the specified order. In contrast, the `Require` directive works on the first match similar to firewall rules. The `Require` directive is the default for Apache 2.4 and is demonstrated in the remediation procedure as it may be less likely to be misunderstood.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Ensure that either one of the following two methods are configured:

**Using the deprecated Order/Deny/Allow method:**

1. Ensure there is a single `Order` directive with the value of `deny, allow`
2. Ensure there is a `Deny` directive, and with the value of `from all`.
3. Ensure there are no `Allow` or `Require` directives in the root `<Directory>` element.

**Using the Require method:**

4. Ensure there is a single `Require` directive with the value of `all denied`
5. Ensure there are no `Allow` or `Deny` directives in the root `<Directory>` element.

The following may be useful in extracting root directory elements from the Apache configuration for auditing.

```bash
$ perl -ne 'print if /^ *<Directory */\/i .. /<\/Directory>/i'
$APACHE_PREFIX/conf/httpd.conf
```

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files (`httpd.conf` and any included configuration files) to find a root `<Directory>` element.
2. Add a single `Require` directive and set the value to `all denied`
3. Remove any `Deny` and `Allow` directives from the root `<Directory>` element.

```apache
<Directory>
   . . .
   Require all denied
   . . .
</Directory>
```

## Default Value

The following is the default root directory configuration:

```apache
<Directory>
   . . .
   Require all denied
   . . .
</Directory>
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#directory
2. https://httpd.apache.org/docs/2.4/mod/mod_authz_host.html

## CIS Controls

**Controls Version: v8**
- **3.3 Configure Data Access Control Lists**
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
  - **IG 1:** •
  - **IG 2:** •
  - **IG 3:** •

**Controls Version: v7**
- **14.6 Protect Information through Access Control Lists**
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
  - **IG 1:** •
  - **IG 2:** •
  - **IG 3:** •

## Profile
- Level 1 | Automated
