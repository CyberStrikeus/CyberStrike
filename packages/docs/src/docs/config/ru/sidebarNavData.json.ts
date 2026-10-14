import type { DocsSidebarNavData } from "../types/configDataTypes";

const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "Документация",
      description: "Основная документация",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "Начало работы",
        },
        {
          id: "usage",
          title: "Использование",
        },
        {
          id: "providers",
          title: "AI Провайдеры",
        },
        {
          id: "agents",
          title: "Агенты",
        },
        {
          id: "tools",
          title: "Инструменты",
        },
        {
          id: "features",
          title: "Возможности",
        },
        {
          id: "configuration",
          title: "Конфигурация",
        },
        {
          id: "permissions",
          title: "Разрешения",
        },
        {
          id: "cli",
          title: "Справка CLI",
        },      ],
    },
  ],
};

export default sidebarNavData;
