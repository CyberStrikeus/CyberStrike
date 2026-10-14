import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "Documentation",
      description: "Documentation principale",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "Commencer",
        },
        {
          id: "usage",
          title: "Utilisation",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "providers",
          title: "Fournisseurs IA",
        },
        {
          id: "agents",
          title: "Agents",
        },
        {
          id: "tools",
          title: "Outils",
        },
        {
          id: "configuration",
          title: "Configuration",
        },
      ],
    },
  ],
};

export default sidebarNavData;
