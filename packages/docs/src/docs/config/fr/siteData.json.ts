import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Documentation officielle de Cyberstrike - Agent de tests de pénétration alimenté par l'IA. Apprenez à installer, configurer et utiliser Cyberstrike pour la recherche en sécurité.",
  navSocials: [
    {
      social: "GitHub",
      link: "https://github.com/CyberStrikeus/CyberStrike",
      icon: "mdi/github",
    },
    {
      social: "Discord",
      link: "https://discord.gg/dr97wVJVbn",
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
      link: "https://discord.gg/dr97wVJVbn",
      icon: "tabler/brand-discord",
    },
  ],
  // default image for meta tags if the page doesn't have an image already
  defaultImage: {
    src: "/images/cyberstrike-docs-og.png",
    alt: "Documentation Cyberstrike",
  },
  // Your information for SEO purposes
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
