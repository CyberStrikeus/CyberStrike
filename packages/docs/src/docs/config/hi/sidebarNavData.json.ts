import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
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
          id: "features",
          title: "Features",
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
          id: "configuration",
          title: "कॉन्फ़िगरेशन",
        },
      ],
    },
  ],
};

export default sidebarNavData;
