import type { DocsSidebarNavData } from "../types/configDataTypes";

const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "दस्तावेज़",
      description: "मुख्य दस्तावेज़",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "शुरुआत",
        },
        {
          id: "usage",
          title: "उपयोग",
        },
        {
          id: "providers",
          title: "AI प्रदाता",
        },
        {
          id: "agents",
          title: "एजेंट",
        },
        {
          id: "tools",
          title: "उपकरण",
        },
        {
          id: "features",
          title: "सुविधाएँ",
        },
        {
          id: "configuration",
          title: "कॉन्फ़िगरेशन",
        },
        {
          id: "permissions",
          title: "अनुमतियाँ",
        },
        {
          id: "cli",
          title: "CLI संदर्भ",
        },
        {
          id: "resources",
          title: "संसाधन",
        },
      ],
    },
  ],
};

export default sidebarNavData;
