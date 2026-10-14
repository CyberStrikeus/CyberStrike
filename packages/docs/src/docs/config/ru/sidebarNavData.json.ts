import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
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
          id: "features",
          title: "Features",
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
          id: "configuration",
          title: "Конфигурация",
        },
      ],
    },
  ],
};

export default sidebarNavData;
