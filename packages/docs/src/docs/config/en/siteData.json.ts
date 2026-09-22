import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Official documentation for Cyberstrike - AI-Powered Penetration Testing Agent. Learn how to install, configure, and use Cyberstrike for security research.",
  navSocials: [
    {
      social: "GitHub",
      link: "https://github.com/CyberStrikeus/CyberStrike",
      icon: "mdi/github",
    },
    {
      social: "Discord",
      link: "https://discord.gg/AbESxpk6",
      icon: "tabler/brand-discord",
    },
  ],
  footerSocials: [
    /*{
      social: "X formerly known as Twitter",
      link: "https://x.com/cyberstrike_io",
      icon: "tabler/brand-x",
    },*/
    {
      social: "GitHub",
      link: "https://github.com/CyberStrikeus/CyberStrike",
      icon: "tabler/brand-github",
    },
    {
      social: "Discord",
      link: "https://discord.gg/AbESxpk6",
      icon: "tabler/brand-discord",
    },
  ],
  // default image for meta tags if the page doesn't have an image already
  defaultImage: {
    src: "/images/cyberstrike-docs-og.png",
    alt: "Cyberstrike Documentation",
  },
  // Your information for SEO purposes
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
