const RTL_LOCALES = ["fa"]

export function direction(locale: string) {
  if (RTL_LOCALES.includes(locale)) return "rtl"
  return "ltr"
}
