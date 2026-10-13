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
          id: "providers",
          title: "AI Providers",
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
          id: "features",
          title: "Features",
        },
        {
          id: "configuration",
          title: "Configuration",
        },
        {
          id: "permissions",
          title: "Permissions",
        },
        {
          id: "cli",
          title: "CLI Reference",
        },
        {
          id: "slash-commands",
          title: "Slash Commands",
        },
        {
          id: "resources",
          title: "Resources",
        },
      ],
    },
  ],
};

export default sidebarNavData;
