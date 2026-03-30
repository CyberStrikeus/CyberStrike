export const domain = (() => {
  if ($app.stage === "production") return "cyberstrike.io"
  if ($app.stage === "dev") return "dev.cyberstrike.io"
  return `${$app.stage}.dev.cyberstrike.io`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"

// Regional hostname pinning — requires Addressing permission on CF token
// new cloudflare.RegionalHostname("RegionalHostname", {
//   hostname: domain,
//   regionKey: "us",
//   zoneId: zoneID,
// })

export const shortDomain = (() => {
  if ($app.stage === "production") return "cybrstk.us"
  if ($app.stage === "dev") return "dev.cybrstk.us"
  return `${$app.stage}.dev.cybrstk.us`
})()
