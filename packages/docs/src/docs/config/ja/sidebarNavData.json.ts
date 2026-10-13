import type { DocsSidebarNavData } from "../types/configDataTypes";

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
          id: "features",
          title: "機能",
        },
        {
          id: "configuration",
          title: "設定",
        },
        {
          id: "permissions",
          title: "権限",
        },
        {
          id: "cli",
          title: "CLIリファレンス",
        },
        {
          id: "resources",
          title: "リソース",
        },
      ],
    },
  ],
};

export default sidebarNavData;
