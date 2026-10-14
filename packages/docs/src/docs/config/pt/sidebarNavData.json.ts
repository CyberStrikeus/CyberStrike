import type { DocsSidebarNavData } from "../types/configDataTypes";

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
          id: "features",
          title: "Funcionalidades",
        },
        {
          id: "configuration",
          title: "Configuração",
        },
        {
          id: "permissions",
          title: "Permissões",
        },      ],
    },
  ],
};

export default sidebarNavData;
