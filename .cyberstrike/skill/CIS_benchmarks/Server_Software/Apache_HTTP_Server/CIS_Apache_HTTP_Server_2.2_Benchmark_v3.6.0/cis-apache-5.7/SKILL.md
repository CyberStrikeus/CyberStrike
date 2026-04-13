---
name: cis-apache-5.7
description: "Ensure HTTP Request Methods Are Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options, http-methods]
cis_id: "5.7"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure HTTP Request Methods Are Restricted

## Description

Use the Apache `<LimitExcept>` directive to restrict unnecessary HTTP request methods of the web server so it only accepts and processes the `GET`, `HEAD`, `POST` and `OPTIONS` HTTP request methods.

## Rationale

The HTTP 1.1 protocol supports several request methods which are rarely used and potentially high risk. For example, methods such as `PUT` and `DELETE` are rarely used and should be disabled in keeping with the security principle of minimizing features and options. Also, since these methods are rarely used, they typically have to modify resources on the web server, they should be explicitly disallowed. For normal web server operation, you will typically need to allow only the `GET`, `HEAD` and `POST` request methods. This will allow for downloading web pages and submitting information to web forms. The `OPTIONS` request method will also be allowed as it is used to request which HTTP request methods are allowed. Unfortunately, the Apache `<LimitExcept>` directive does not deny the `TRACE` request method. The `TRACE` request method is disallowed in another benchmark recommendation with the `TraceEnable` directive.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Search for all `<Directory>` directives other than the OS root directory.
3. Ensure that group contains a single `Order` directive within the `<Directory>` directive with a value of `deny,allow`.
4. Verify the `<LimitExcept>` directive does not include any HTTP methods other than `GET`, `POST`, and `OPTIONS`. (It may contain fewer methods.)

## Remediation

Perform the following to implement the recommended state:

1. Locate the Apache configuration files and included configuration files.
2. Search for the directive on the document root directory, such as:

```apache
<Directory "/usr/local/apache2/htdocs">
   . . .
</Directory>
```

3. Ensure that the access control order within the `<Directory>` directive is `deny,allow`.

```apache
Order allow,deny
```

4. Add a directive as shown below within the group of document root directives.

```apache
# Limit HTTP methods to standard methods. Note: Does not limit TRACE
<LimitExcept GET POST OPTIONS>
   Deny from all
</LimitExcept>
```

5. Search for other directives in the Apache configuration files in places other than the root directory, and add the same directives to each. It is very important to understand that the directives are based on the OS file system hierarchy as accessed by Apache and not the hierarchy of the locations within web site URLs.

```apache
<Directory "/usr/local/apache2/cgi-bin">
   . . .
   Order allow,deny
   # Limit HTTP methods
   <LimitExcept GET POST OPTIONS>
      Deny from all
   </LimitExcept>
</Directory>
```

## Default Value

No limits on HTTP methods

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#limitexcept
2. https://www.ietf.org/rfc/rfc2616.txt

## CIS Controls

Version 6

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 1 | Scored
