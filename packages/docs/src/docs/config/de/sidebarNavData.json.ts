import type { DocsSidebarNavData } from "../types/configDataTypes";

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
          id: "providers",
          title: "KI-Anbieter",
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
          id: "features",
          title: "Funktionen",
        },
        {
          id: "configuration",
          title: "Konfiguration",
        },
        {
          id: "permissions",
          title: "Berechtigungen",
        },      ],
    },
  ],
};

export default sidebarNavData;
