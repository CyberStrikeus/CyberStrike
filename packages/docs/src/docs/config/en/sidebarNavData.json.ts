import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "Documentation",
      description: "Main documentation",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "Getting Started",
        },
        {
          id: "usage",
          title: "Usage",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "agents",
          title: "Agents",
        },
        {
          id: "tools",
          title: "Tools",
        },
        {
          id: "configuration",
          title: "Configuration",
        },      ],
    },
  ],
};

export default sidebarNavData;
