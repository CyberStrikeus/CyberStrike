# MUFG MPT Security Testing Checklist Library

## Why Was This Library Created?

### The Real Problems We Faced

As the MUFG Manual Penetration Testing (MPT) team, we run security assessments on different applications every week. During these tests, we kept running into the same questions:

**"Did I test SSTI on this endpoint?"**

When an application has 50+ endpoints, remembering which tests you ran on which endpoint becomes difficult. A tester might thoroughly examine SQL injection while skipping Server-Side Template Injection on the same endpoint. Without a checklist, you cannot track what you tested and what you missed.

**"How do I document this finding?"**

When the audit team asked "what payloads did you try for SSRF?", we could not give a clear answer. Saying "we tested it, found nothing" is not enough. You need to show which payloads you attempted, which bypass techniques you applied.

**"A new person joined the team, how do we train them?"**

When senior testers leave, the techniques they accumulated over years leave with them. Junior testers have to rediscover the same things from scratch. In an environment where everyone gives a different answer to "how do you test for Mass Assignment?", maintaining consistency is impossible.

---

## What Do These Checklists Provide?

### 1. During Testing: Missing Nothing

Every checklist file has a "What to Check" section. For example, WSTG-INPV-19 (SSRF):

```
- [ ] URL parameter manipulation
- [ ] Internal service access
- [ ] Cloud metadata access
- [ ] Protocol smuggling
- [ ] Blind SSRF
- [ ] DNS rebinding
```

You do not mark that test case as "done" until you complete this list. No chance of skipping.

### 2. Writing Reports: Copy-Paste Remediation

You found a SQL Injection. Now you need to explain to the development team how to fix it. Open WSTG-INPV-05.md, grab the code example in the relevant language from the "Remediation" section:

```python
# Using prepared statements
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

Paste it into your report. Instead of telling the developer "use parameterized queries", you give them working code.

### 3. During Audits: Provable Test Coverage

GRC team asks: "Were input validation tests performed?"

Answer: "Yes, all 29 test cases in the WSTG-INPV category were completed. Test dates, payloads used, and results were documented for each one."

With CWE mapping: "CWE-89 (SQL Injection), CWE-79 (XSS), CWE-78 (Command Injection) and 15 other CWE categories were tested."

### 4. For New Team Members: Structured Onboarding

A junior tester does not ask "how do I test for XSS?" on their first day. They open WSTG-INPV-01.md, follow the step-by-step instructions. They run the bash scripts, use the Python tools. They learn while producing real work.

---

## Checklist Structure

Every checklist file follows the same template:

### Test ID and Name
```
WSTG-INPV-05: Testing for SQL Injection
```
Unique identifier for reference.

### High-Level Description
2-3 sentence explanation of the vulnerability. At a level you can show to non-technical stakeholders.

### What to Check
List of specific points to test. You check them off as you progress.

### How to Test
Two formats:

**Bash scripts** - For quick manual testing:
```bash
sqlmap -u "https://target.com/page?id=1" --batch --level=3
```

**Python classes** - For automated, repeatable testing:
```python
tester = SQLInjectionTester("https://target.com")
tester.run_tests()
```

### Remediation
Fix recommendations for the development team. Code examples in multiple languages (Python, Java, PHP, Node.js).

### Risk Assessment
CVSS scores and severity levels. Format ready to transfer directly to reports.

### CWE Mapping
Weakness categories for compliance documentation.

---

## Daily Usage Scenarios

### Scenario 1: Starting a New Application Test

1. Scope is determined (web app, API, mobile)
2. Relevant WSTG categories are selected
3. Start with WSTG-INFO (reconnaissance)
4. Complete each category in order
5. Check off checklist items for each test case
6. Document findings with their WSTG ID

### Scenario 2: Critical Finding Discovered

1. Determine the finding's WSTG ID (e.g., WSTG-INPV-05 SQL Injection)
2. Open the relevant checklist
3. Get the CVSS score from "Risk Assessment" section
4. Get the fix recommendation from "Remediation" section
5. Get the CWE ID from "CWE Mapping" section
6. Add all information to the report

### Scenario 3: GRC Audit Preparation

1. Extract WSTG coverage of tests done in the last 12 months
2. Calculate completion rate for each category
3. Prepare CWE coverage list
4. Compile sample evidence files

### Scenario 4: Junior Tester Training

1. Assign WSTG-INFO category to the junior tester
2. Ask them to complete each test case in order
3. They learn by running bash scripts
4. They learn to customize Python tools
5. Within 2-3 weeks they can test independently

---

## File Organization

```
MUFG-Checklists/
├── README.md                 # This file
└── web-application/
    ├── WSTG-INFO/           # 10 tests - Reconnaissance
    ├── WSTG-CONF/           # 13 tests - Server configuration
    ├── WSTG-IDNT/           # 5 tests - Identity management
    ├── WSTG-ATHN/           # 11 tests - Authentication
    ├── WSTG-AUTHZ/          # 7 tests - Authorization
    ├── WSTG-SESS/           # 11 tests - Session management
    ├── WSTG-INPV/           # 29 tests - Input validation (injection attacks)
    ├── WSTG-ERRH/           # 2 tests - Error handling
    ├── WSTG-CRYP/           # 4 tests - Cryptography
    ├── WSTG-BUSL/           # 10 tests - Business logic
    ├── WSTG-CLNT/           # 14 tests - Client-side
    └── WSTG-APIT/           # 4 tests - API security
```

Total: **120 test cases**

---

## How These Checklists Differ from OWASP WSTG

OWASP WSTG is already a public document. Why use these checklists instead of reading that directly?

### What OWASP WSTG Has
- Vulnerability descriptions
- General test methodology
- Conceptual knowledge

### What These Checklists Add
- **Ready-to-run bash scripts** - Copy-paste and execute
- **Python automation classes** - Import and use
- **Tested payload collections** - Payloads that work in real tests
- **Multi-language remediation code** - Give directly to developers
- **Pre-calculated CVSS** - Ready scores for risk assessment
- **CWE mapping** - Ready for compliance documentation
- **Checklist format** - Checkable lists for progress tracking

OWASP WSTG is a reference document. These checklists are a work tool.

---

## Contributing

Found a new bypass technique? Discovered a more effective payload? Add it to the relevant checklist file. Let the whole team benefit.

When updating:
1. Test the payload, make sure it works
2. Specify which environment it works in (WAF bypass, specific framework, etc.)
3. Add date
4. Add your name

---

**Version:** 1.0
**Last Updated:** January 2025
**Maintainer:** MUFG MPT Team
