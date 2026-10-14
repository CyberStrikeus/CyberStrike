import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Combined sidebar navigation data for the French locale
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
          id: "features",
          title: "Fonctionnalités",
        },
        {
          id: "configuration",
          title: "Configuration",
        },      ],
    },
  ],
};

export default sidebarNavData;
