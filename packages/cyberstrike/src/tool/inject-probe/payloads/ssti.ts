const SSTI_A = 7919
const SSTI_B = 6841
export const SSTI_EXPR = `${SSTI_A}*${SSTI_B}`
export const SSTI_PRODUCT = String(SSTI_A * SSTI_B)

export const SSTI_SYNTAXES: { name: string; wrap: (e: string) => string }[] = [
  { name: "{{ }}", wrap: (e) => `{{${e}}}` },
  { name: "${ }", wrap: (e) => `\${${e}}` },
  { name: "#{ }", wrap: (e) => `#{${e}}` },
  { name: "<%= %>", wrap: (e) => `<%= ${e} %>` },
  { name: "@( )", wrap: (e) => `@(${e})` },
  { name: "%{ }", wrap: (e) => `%{${e}}` },
  { name: "*{ }", wrap: (e) => `*{${e}}` },
  { name: "[[${ }]]", wrap: (e) => `[[\${${e}}]]` },
  { name: "{{= }}", wrap: (e) => `{{=${e}}}` },
]

const SSTI_ADD_A = 7919191
const SSTI_ADD_SUM = String(SSTI_ADD_A + SSTI_B)

export const SSTI_ALT: { name: string; payload: string; product: string; literal: string }[] = [
  {
    name: "django {{|add:}}",
    payload: `{{ ${SSTI_ADD_A}|add:${SSTI_B} }}`,
    product: SSTI_ADD_SUM,
    literal: `${SSTI_ADD_A}|add:${SSTI_B}`,
  },
  { name: "jinja {% set %}", payload: `{% set _p=${SSTI_EXPR} %}{{_p}}`, product: SSTI_PRODUCT, literal: SSTI_EXPR },
]

export const SSTI_NOT_TESTED = [
  "blind/out-of-band SSTI (evaluated result not reflected in the response)",
  "non-arithmetic template gadgets (config/object access, RCE chains — this tool only checks arithmetic evaluation)",
  "DOM/client-side template evaluation (needs a JS engine)",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]
