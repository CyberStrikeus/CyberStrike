import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Documentação oficial do Cyberstrike – Ferramenta de teste de penetração com IA. Aprenda a instalar, configurar e usar o Cyberstrike para pesquisa de segurança.",
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
  defaultImage: {
    src: "/images/cyberstrike-docs-og.png",
    alt: "Documentação Cyberstrike",
  },
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
