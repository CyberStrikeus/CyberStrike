import type { DocsSiteData } from "../types/configDataTypes";

const docsSiteData: DocsSiteData = {
  title: "Cyberstrike Docs",
  description:
    "Cyberstrike का आधिकारिक दस्तावेज़ - AI-संचालित पेनेट्रेशन टेस्टिंग टूल। Cyberstrike को इंस्टॉल, कॉन्फ़िगर और सुरक्षा अनुसंधान के लिए उपयोग करना सीखें।",
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
    alt: "Cyberstrike दस्तावेज़",
  },
  author: {
    name: "Cyberstrike",
    email: "contact@cyberstrike.io",
    twitter: "cyberstrike_io",
  },
};

export default docsSiteData;
