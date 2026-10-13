import type { DocsSidebarNavData } from "../types/configDataTypes";

const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "文档",
      description: "主要文档",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "入门指南",
        },
        {
          id: "usage",
          title: "使用方法",
        },
        {
          id: "providers",
          title: "AI 提供商",
        },
        {
          id: "agents",
          title: "智能体",
        },
        {
          id: "tools",
          title: "工具",
        },
        {
          id: "features",
          title: "功能",
        },
        {
          id: "configuration",
          title: "配置",
        },
        {
          id: "permissions",
          title: "权限",
        },
        {
          id: "cli",
          title: "CLI 参考",
        },
        {
          id: "resources",
          title: "资源",
        },
      ],
    },
  ],
};

export default sidebarNavData;
