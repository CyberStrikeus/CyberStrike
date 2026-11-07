import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Cyberstrike 公式ドキュメント - AI搭載ペネトレーションテストツール。インストール、設定、セキュリティ研究での活用方法をご紹介します。",
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
    alt: "Cyberstrike ドキュメント",
  },
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
