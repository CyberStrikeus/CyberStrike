import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "Dokumentation",
      description: "Hauptdokumentation",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "Erste Schritte",
        },
        {
          id: "usage",
          title: "Verwendung",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "agents",
          title: "Agenten",
        },
        {
          id: "tools",
          title: "Werkzeuge",
        },
        {
          id: "configuration",
          title: "Konfiguration",
        },
      ],
    },
  ],
};

export default sidebarNavData;
