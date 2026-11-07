import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Cyberstrike 官方文档 - AI 驱动的渗透测试工具。了解如何安装、配置和使用 Cyberstrike 进行安全研究。",
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
    alt: "Cyberstrike 文档",
  },
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
