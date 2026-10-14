import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "ドキュメント",
      description: "メインドキュメント",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "はじめに",
        },
        {
          id: "usage",
          title: "使い方",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "providers",
          title: "AIプロバイダー",
        },
        {
          id: "agents",
          title: "エージェント",
        },
        {
          id: "tools",
          title: "ツール",
        },
        {
          id: "configuration",
          title: "設定",
        },
      ],
    },
  ],
};

export default sidebarNavData;
