"""REA offline adapter using mitmproxy's unchanged native tnetstring decoder.

No FlowReader migrations, HAR conversion, proxy listener, or target requests.
The containing mitmdump process and its configuration directory are REA-owned.
"""

import base64
import hashlib
import ipaddress
import json
import math
import re
import resource
from pathlib import Path
from urllib.parse import unquote_to_bytes

from mitmproxy import ctx, version
from mitmproxy.io import tnetstring

PROFILE = "12.2.3"
OUTPUT_BYTES = 96 * 1024 * 1024
CREDENTIALS = {b"authorization", b"proxy-authorization", b"cookie", b"set-cookie"}


class CaptureFailure(Exception):
    def __init__(self, reason, message, pointer=""):
        self.reason, self.pointer = reason, pointer
        super().__init__(message)


def pointer(parent, key):
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


class BoundedReader:
    """Refuse malicious declared lengths before the upstream parser allocates."""
    def __init__(self, handle, size):
        self.handle, self.size = handle, size

    def read(self, count):
        if count < 0 or count > self.size - self.handle.tell():
            raise CaptureFailure("format", "Native record declares bytes beyond the retained capture.")
        return self.handle.read(count)


SPECIAL_SCHEMES = {"ftp", "file", "http", "https", "ws", "wss"}
SCHEME_PREFIX = r"^[\x00-\x20]*([a-z][a-z0-9+.-]*):"
NETWORK_PREFIX = r"^[\x00-\x20]*[/\\]{2}"
URL_IGNORABLE_CONTROLS = "\t\n\r"
URL_CONTROL_TRANSLATION = {ord(char): None for char in URL_IGNORABLE_CONTROLS}
C0_CONTROL_OR_SPACE = "".join(chr(code) for code in range(0x21))
FORBIDDEN_DOMAIN_CODE_POINTS = set(C0_CONTROL_OR_SPACE) | set("#%/:<>?@[\\]^|\x7f")


def authority_start(text, base_scheme=None):
    """Return where an authority begins and whether it is special, or None.

    Follows WHATWG URL parsing as src/domain/recordedTransportUrl.ts does:
    special schemes (and scheme-relative references) skip every leading "/"
    or "\\" before the authority, so `https://\\user:pass@host` still has
    userinfo. File URLs never carry userinfo: an "@" in a file host makes
    WHATWG reject the whole URL, so there are no credentials to remove.
    """
    scheme = re.match(SCHEME_PREFIX, text, flags=re.I)
    name = scheme.group(1).lower() if scheme is not None else None
    if name == "file" or (name is None and base_scheme == "file"):
        return None
    if name is not None and name in SPECIAL_SCHEMES:
        # A same-scheme Location without two slash-equivalent separators is
        # relative to the recorded request, so its @ belongs to the path.
        following = text[scheme.end():scheme.end() + 2]
        if name == base_scheme and (len(following) < 2 or any(char not in "/\\" for char in following)):
            return None
        start = scheme.end()
    else:
        if scheme is not None:
            if text[scheme.end():scheme.end() + 2] != "//":
                return None
            return scheme.end() + 2, False
        # A non-special base treats backslashes as authority data and only
        # recognizes two forward slashes as a network reference.
        if base_scheme is not None and base_scheme not in SPECIAL_SCHEMES:
            prefix = re.match(r"^[\x00-\x20]*//", text)
            return None if prefix is None else (prefix.end(), False)
        prefix = re.match(NETWORK_PREFIX, text)
        if prefix is None:
            return None
        start = prefix.end()
    while start < len(text) and text[start] in "/\\":
        start += 1
    return start, True


IPV4_DIGITS = {8: "01234567", 10: "0123456789", 16: "0123456789abcdefABCDEF"}


def ipv4_number(part):
    """WHATWG IPv4 number parser: decimal, 0x hex or 0-prefixed octal, else None."""
    if part == "":
        return None
    radix, digits = 10, part
    if part[:2] in ("0x", "0X"):
        radix, digits = 16, part[2:]
    elif len(part) > 1 and part[0] == "0":
        radix, digits = 8, part[1:]
    if digits == "":
        return 0
    if any(char not in IPV4_DIGITS[radix] for char in digits):
        return None
    # Bound decimal text before int(): Python limits decimal conversions to
    # 4300 digits, and anything past 10 significant digits exceeds IPv4.
    significant = digits.lstrip("0")
    if radix == 10 and len(significant) > 10:
        return 2**32
    return int(digits, radix)


def domain_parses(domain):
    """Apply WHATWG's ends-in-a-number check and IPv4 parser to a domain."""
    parts = domain.split(".")
    if parts[-1] == "" and len(parts) > 1:
        parts.pop()
    last = parts[-1]
    if not ((last != "" and last.isascii() and last.isdigit()) or ipv4_number(last) is not None):
        return True
    numbers = [ipv4_number(part) for part in parts]
    if len(parts) > 4 or any(number is None for number in numbers):
        return False
    return all(number <= 255 for number in numbers[:-1]) and numbers[-1] < 256 ** (5 - len(numbers))


def special_host_parses(host_port):
    """Whether WHATWG could accept a special authority's host and port.

    A rejected host fails the whole URL, so it has no credentials to remove.
    This mirrors the forbidden-code-point, empty-host, IPv4, IPv6 and port
    rules for ASCII hosts. UTS #46 mapping is not modeled: a non-ASCII host
    may map to an accepted one (fullwidth digits, ideographic full stops,
    ignored code points), so it is treated as accepted and still redacts.
    """
    if host_port.startswith("["):
        host_end = host_port.find("]") + 1
        literal = host_port[1 : host_end - 1]
        if host_end == 0 or "%" in literal:
            return False
        try:
            ipaddress.IPv6Address(literal)
        except ValueError:
            return False
    else:
        colon = host_port.find(":")
        host_end = len(host_port) if colon < 0 else colon
        host = unquote_to_bytes(host_port[:host_end]).decode("utf-8", errors="replace")
        # Mapping never removes ASCII, so these rejections hold either way.
        if host == "" or any(char in FORBIDDEN_DOMAIN_CODE_POINTS for char in host):
            return False
        if host.isascii() and not domain_parses(host.lower()):
            return False
    port = host_port[host_end:]
    if port == "":
        return True
    digits = port[1:]
    if port[0] != ":" or not (digits == "" or (digits.isascii() and digits.isdigit())):
        return False
    # Bound the text first: int() refuses decimal strings over 4300 digits.
    significant = digits.lstrip("0")
    return len(significant) <= 5 and int(significant or "0") <= 65535


def without_userinfo(value, base_scheme=None):
    """Remove an authority's userinfo using the WHATWG authority boundary.

    Special schemes and scheme-relative references also end the authority
    at a backslash, so later path text containing "@" is not userinfo.
    """
    binary = isinstance(value, bytes)
    text = value.decode("latin-1") if binary else value
    # WHATWG removes these controls before interpreting scheme/separators.
    # Keep that parse view separate from the exact source spelling and bytes.
    # It also drops trailing C0 controls and spaces; offsets are unchanged.
    parsed_text = text.translate(URL_CONTROL_TRANSLATION).rstrip(C0_CONTROL_OR_SPACE)
    located = authority_start(parsed_text, base_scheme)
    if located is None:
        return value
    start, special = located
    terminators = "/?#\\" if special else "/?#"
    end = start
    while end < len(parsed_text) and parsed_text[end] not in terminators:
        end += 1
    at = parsed_text.rfind("@", start, end)
    if at < start or (special and not special_host_parses(parsed_text[at + 1 : end])):
        return value
    parsed_offset = 0
    raw_start = 0
    for raw_offset, char in enumerate(text):
        if char in URL_IGNORABLE_CONTROLS:
            continue
        if parsed_offset == start:
            raw_start = raw_offset
        if parsed_offset == at:
            safe = text[:raw_start] + text[raw_offset + 1 :]
            return safe.encode("latin-1") if binary else safe
        parsed_offset += 1
    raise CaptureFailure("decoder", "Normalized URL authority could not be bound to its source.")


def project_record(state, secrets):
    binaries, numbers, redactions = [], [], []
    byte_secrets = []
    for secret in secrets:
        try:
            byte_secrets.append(secret.encode("utf-8", errors="strict"))
        except UnicodeEncodeError:
            # Non-scalar JSON strings have no UTF-8 byte representation.
            # Keep them in secrets for the ordinary string projection.
            pass

    def redact(text, path, original):
        if any(secret in text or secret in original for secret in secrets):
            redactions.append({"pointer": path, "reason": "explicit-sensitive-value"})
            return None
        return text

    def transport_value(value, path, transport_url, base_scheme):
        if not (transport_url or re.fullmatch(r"/(?:backup/)*request/(?:path|authority)", path)):
            return value, False
        binary = isinstance(value, bytes)
        separator = b"@" if binary else "@"
        if transport_url:
            safe_url = without_userinfo(value, base_scheme)
        elif path.endswith("/authority"):
            safe_url = value.rsplit(separator, 1)[-1]
        else:
            # Native request.path is origin-form unless it explicitly carries
            # a scheme (absolute-form). Leading separators are path evidence,
            # not a header URL reference's network authority.
            text = value.decode("latin-1") if binary else value
            safe_url = without_userinfo(value) if re.match(
                SCHEME_PREFIX, text.translate(URL_CONTROL_TRANSLATION), flags=re.I
            ) else value
        changed = safe_url != value
        if changed:
            redactions.append({"pointer": path, "reason": "transport-credential"})
        return safe_url, changed

    def validate_omitted(value, path, depth):
        before = len(binaries), len(numbers), len(redactions)
        visit(value, path, depth)
        del binaries[before[0]:]
        del numbers[before[1]:]
        del redactions[before[2]:]

    def visit(value, path, depth=0, credential=False, transport_url=False, base_scheme=None):
        if depth > 64:
            raise CaptureFailure("input-limit", "Native capture exceeds the 64-level evidence nesting budget.", path)
        if credential:
            validate_omitted(value, path, depth)
            redactions.append({"pointer": path, "reason": "transport-credential"})
            if isinstance(value, bytes):
                binaries.append({"pointer": path, "representation": "producer-bytes", "state": "redacted", "content_base64": None, "bytes": None, "sha256": None})
            return None
        if isinstance(value, bytes):
            safe_bytes, credential_url = transport_value(value, path, transport_url, base_scheme)
            content_base64 = base64.b64encode(value).decode("ascii")
            digest = hashlib.sha256(value).hexdigest()
            hidden = any(secret in value or secret in safe_bytes for secret in byte_secrets) or any(secret in content_base64 or secret in digest or secret in str(len(value)) for secret in secrets)
            safe_text = None
            try:
                safe_text = safe_bytes.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                pass
            if hidden:
                redactions.append({"pointer": path, "reason": "explicit-sensitive-value"})
            exclude = hidden or credential_url
            binaries.append({"pointer": path, "representation": "producer-bytes", "state": "redacted" if exclude else "retained", "content_base64": None if exclude else content_base64, "bytes": None if exclude else len(value), "sha256": None if exclude else digest})
            if hidden:
                return None
            return safe_text
        if isinstance(value, str):
            safe_text, _ = transport_value(value, path, transport_url, base_scheme)
            return redact(safe_text, path, value)
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, (int, float)):
            literal = repr(value)
            if any(secret in literal for secret in secrets):
                redactions.append({"pointer": path, "reason": "explicit-sensitive-value"})
                return None
            numbers.append({"pointer": path, "producer_type": "integer" if isinstance(value, int) else "float", "literal": literal})
            return value if (abs(value) <= 9007199254740991 if isinstance(value, int) else math.isfinite(value)) else None
        if isinstance(value, (list, tuple)):
            fields = re.fullmatch(r"/(?:backup/)*(?:request|response)/(?:headers|trailers)", path)
            if fields:
                result = []
                for index, field in enumerate(value):
                    if not isinstance(field, (list, tuple)) or len(field) != 2 or not isinstance(field[0], bytes):
                        raise CaptureFailure("format", "Native header/trailer is not an ordered byte pair.", pointer(path, index))
                    result.append([visit(field[0], pointer(pointer(path, index), 0), depth + 2), visit(field[1], pointer(pointer(path, index), 1), depth + 2, field[0].lower() in CREDENTIALS, field[0].lower() in {b"location", b"referer", b"origin"}, base_scheme if field[0].lower() == b"location" else None)])
                return result
            return [visit(item, pointer(path, index), depth + 1, base_scheme=base_scheme) for index, item in enumerate(value)]
        if isinstance(value, dict):
            if path == "" or re.fullmatch(r"/backup(?:/backup)*", path):
                request = value.get("request")
                scheme = request.get("scheme") if isinstance(request, dict) else None
                if isinstance(scheme, bytes):
                    scheme = scheme.decode("latin-1")
                base_scheme = scheme.lower() if isinstance(scheme, str) and re.fullmatch(r"[a-z][a-z0-9+.-]*", scheme, flags=re.I) else None
            result = {}
            for key, item in value.items():
                if not isinstance(key, str):
                    raise CaptureFailure("format", "Native record has a non-string dictionary key.", path)
                if any(secret in key for secret in secrets):
                    # Validate the omitted subtree too, then discard all of its
                    # coordinates rather than inventing a replacement identity.
                    validate_omitted(item, pointer(path, key), depth + 1)
                    redactions.append({"pointer": path, "reason": "explicit-sensitive-value", "scope": "property-name"})
                    continue
                result[key] = visit(item, pointer(path, key), depth + 1, base_scheme=base_scheme)
            return result
        raise CaptureFailure("decoder", "Native parser returned an unexpected value type: " + type(value).__name__ + ".", path)

    return {"reported": visit(state, ""), "binary_fields": binaries, "numeric_literals": numbers, "redactions": redactions}


def decode(request):
    if version.VERSION != PROFILE:
        raise CaptureFailure("unsupported", "Expected mitmproxy " + PROFILE + "; observed " + version.VERSION + ".")
    records = []
    capture = Path(request["snapshot_path"])
    size = capture.stat().st_size
    with capture.open("rb") as handle:
        reader = BoundedReader(handle, size)
        while handle.tell() < size:
            start = handle.tell()
            try:
                state = tnetstring.load(reader)
            except CaptureFailure:
                raise
            except RecursionError:
                raise CaptureFailure("input-limit", "Native parser exceeded its recursion budget at byte offset " + str(start) + ".") from None
            except (ValueError, IndexError, UnicodeError, EOFError):
                raise CaptureFailure("format", "Malformed native record at byte offset " + str(start) + ".") from None
            if not isinstance(state, dict):
                raise CaptureFailure("format", "Native flow record must be a dictionary at byte offset " + str(start) + ".")
            records.append({"ordinal": len(records), "location": {"kind": "byte-range", "offset": start, "bytes": handle.tell() - start}, **project_record(state, request["sensitive_values"]), "limitations": ["Fields are original native states without FlowReader migration. Binary fields contain exact producer bytes; reported UTF-8 strings for those fields are derived display views. Unknown flow/version extensions are retained without interpretation."]})
    return {"decoder": {"id": "mitmproxy-native-tnetstring", "name": "REA offline native mitmproxy adapter", "version": PROFILE}, "container": {"reported": None, "numeric_literals": [], "redactions": [], "records_pointer": None}, "total_records": len(records), "records": records}


def failure_reply(error):
    """Keep producer constraints, resource exhaustion and adapter defects distinct."""
    if isinstance(error, CaptureFailure):
        return {"ok": False, "reason": error.reason, "message": str(error), "pointer": error.pointer}
    if isinstance(error, MemoryError):
        return {"ok": False, "reason": "resource-limit", "message": "Native decoder exhausted its 768 MiB address-space budget.", "pointer": ""}
    return {"ok": False, "reason": "decoder", "message": "Offline native decoder failed unexpectedly: " + type(error).__name__ + ".", "pointer": ""}


class OfflineCapture:
    def load(self, loader):
        loader.add_option("rea_request_path", str, "", "REA private offline capture request")

    def running(self):
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
        resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_BYTES, OUTPUT_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        request = json.loads(Path(ctx.options.rea_request_path).read_text(encoding="utf-8"))
        try:
            response = {"ok": True, "value": decode(request)}
        except Exception as error:
            response = failure_reply(error)
        try:
            try:
                output = json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
            except Exception as error:
                output = json.dumps(failure_reply(error), separators=(",", ":")).encode("ascii")
            if len(output) > OUTPUT_BYTES:
                output = b'{"ok":false,"reason":"limit","message":"Native reply exceeds the complete-evidence output budget.","pointer":""}'
            Path(request["reply_path"]).write_bytes(output)
        finally:
            ctx.master.shutdown()


addons = [OfflineCapture()]
