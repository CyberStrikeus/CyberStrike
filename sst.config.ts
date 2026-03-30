/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "cyberstrike",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        ...(process.env.STRIPE_SECRET_KEY ? { stripe: { apiKey: process.env.STRIPE_SECRET_KEY } } : {}),
        ...(process.env.PLANETSCALE_SERVICE_TOKEN ? { planetscale: "0.4.1" } : {}),
      },
    }
  },
  async run() {
    await import("./infra/app.js")
    if (process.env.STRIPE_SECRET_KEY && process.env.PLANETSCALE_SERVICE_TOKEN)
      await import("./infra/console.js")
    if (process.env.CYBERSTRIKE_ENTERPRISE)
      await import("./infra/enterprise.js")
  },
})
