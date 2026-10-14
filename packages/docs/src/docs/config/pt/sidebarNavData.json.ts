import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "Documentação",
      description: "Documentação principal",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "Primeiros Passos",
        },
        {
          id: "usage",
          title: "Utilização",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "providers",
          title: "Provedores de IA",
        },
        {
          id: "agents",
          title: "Agentes",
        },
        {
          id: "tools",
          title: "Ferramentas",
        },
        {
          id: "configuration",
          title: "Configuração",
        },
      ],
    },
  ],
};

export default sidebarNavData;
