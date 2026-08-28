---
name: cis-apache24-5.7
description: "Ensure HTTP Request Methods Are Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.7"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.7 Ensure HTTP Request Methods Are Restricted

## Profile Applicability

- Level 2

## Description

Use the Apache `<LimitExcept>` directive to restrict unnecessary HTTP request methods of the web server to only accept and process the `GET`, `HEAD`, `POST` and `OPTIONS` HTTP request methods.

## Rationale

The HTTP 1.1 protocol supports several request methods which are rarely used and potentially high risk. For example, methods such as `PUT` and `DELETE` are rarely used and should be disabled in keeping with the primary security principal of minimize features and options. Also since the usage of these methods is typically to modify resources on the web server, they should be explicitly disallowed. For normal web server operation, you will typically need to allow only the `GET`, `HEAD` and `POST` request methods. This will allow for downloading of web pages and submitting information to web forms. The `OPTIONS` request method will also be allowed as it used to request which HTTP request methods are allowed. Unfortunately, the Apache `<LimitExcept>` directive does not deny the `TRACE` request method. The `TRACE` request method will be disallowed in another benchmark recommendation with the `TraceEnable` directive.

## Audit

Perform the following to determine if the recommended state is implemented:

Locate the Apache configuration files and included configuration files.

Search for all <Directory> directives other than the OS root directory.

Ensure that either one of the following three methods are configured:

**Using the deprecated Order/Deny/Allow method:**

1. Within each <Directory> section, ensure that there is a single <LimitExcept> directive containing a value of `Order deny, allow`.
2. Verify the <LimitExcept> directive does not include any HTTP methods other than GET, POST, and OPTIONS. (It may contain fewer methods.)

The section should resemble this example:

```
<Directory /var/www/html>
  # other directives
  <LimitExcept GET POST OPTIONS>
    Order deny, allow
  </LimitExcept>
</Directory>
```

**Using the Require method:**

1. Within each <Directory> section, ensure that there is a single <LimitExcept> directive containing a single instance of `Require all denied`.
2. Ensure there are no Allow or Deny directives in the root element.

The section should resemble this example:

```
<Directory /var/www/html>
  # other directives
  <LimitExcept GET POST OPTIONS>
    Require all denied
  </LimitExcept>
</Directory>
```

**Using the experimental allow methods_module**

1. Ensure that the `methods_module` has been loaded by Apache.
2. Within each <Directory> section, ensure that there is a single AllowMethods line and verify that there are no methods other than GET, POST, and OPTIONS.

The section should resemble this example:

```
<Directory /var/www/html>
  # other directives
  AllowMethods GET POST OPTIONS
</Directory>
```

## Remediation

Perform the following to implement the recommended state:

1. Locate the Apache configuration files and included configuration files.
2. Search for the directive on the document root directory such as:
3. `<Directory "/usr/local/apache2/htdocs">`
4. `. . .`
5. `</Directory>`
6. Add a directive as shown below within the group of document root directives.
7. `# Limit HTTP methods to standard methods. Note: Does not limit TRACE`
8. `<LimitExcept GET POST OPTIONS>`
9. `    Require all denied`
10. `</LimitExcept>`
11. Search for other directives in the Apache configuration files other than the OS root directory and add the same directives to each. It is very important to understand that the directives are based on the OS file system hierarchy as accessed by Apache and not the hierarchy of the locations within web site URLs.
12. `<Directory "/usr/local/apache2/cgi-bin">`
13. `. . .`
14. `# Limit HTTP methods`
15. `<LimitExcept GET POST OPTIONS>`
16. `    Require all denied`
17. `</LimitExcept>`
18. `</Directory>`

or use the experimental AllowMethods module

1. Locate the Apache configuration files and included configuration files.
2. Search for the directive "AllowMethods" on the document root directory such as:
3. `<Directory "/usr/local/apache2/htdocs">`
4. `. . .`
5. `</Directory>`
6. Add a directive as shown below within the group of document root directives.

LoadModule allowmethods_module modules/mod_allowmethods.so

<Directory /var/www> #other directives AllowMethods GET POST OPTIONS
</Directory>

4. Search for other directives in the Apache configuration files other than the OS root directory and add the same directives to each. It is very important to understand that the directives are based on the OS file system hierarchy as accessed by Apache and not the hierarchy of the locations within web site URLs.

LoadModule allowmethods_module modules/mod_allowmethods.so

<Directory /var/www> #other directives AllowMethods GET POST OPTIONS
</Directory>

The `LimitExcept` implementation may not work well for proxy configurations or systems with many locations or directories.
A global rewrite condition can be implemented either by explicitly forbidding REQUEST_METHODs or by rejecting everything but the allowed REQUEST_METHODs

1. Reject specific REQUEST_METHODs

RewriteEngine On RewriteCond %{REQUEST_METHOD} ^(PUT|DELETE|TRACE|OPTIONS|CONNECT)$ [NC] RewriteRule .\* - [F]

2. Reject everything but allowed REQUEST_METHODs

RewriteCond %{REQUEST_METHOD} ^((?!(GET|POST|OPTIONS)).)$ [NC]
RewriteRule . - [F]

## Default Value

No Limits on HTTP methods.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#limitexcept
2. https://www.ietf.org/rfc/rfc2616.txt

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.6 Use of Secure Network Management and Communication Protocols<br>Use secure network management and communication protocols (e.g., 802.1X, Wi-Fi Protected Access 2 (WPA2) Enterprise or greater).          |      | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. |      | ●    | ●    |

## Profile

- Level 2 | Manual
