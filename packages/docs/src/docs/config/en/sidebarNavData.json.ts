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
          id: "providers",
          title: "AI Providers",
        },
        {
          id: "agents",
          title: "Agents",
        },
        {
          id: "usage",
          title: "Usage",
        },
        {
          id: "tools",
          title: "Tools",
        },
        {
          id: "mcp",
          title: "Bolt / MCP",
        },
        {
          id: "web-testing",
          title: "Web Testing",
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
