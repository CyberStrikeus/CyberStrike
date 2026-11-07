import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Cyberstrike Documentation Sidebar Navigation
 */
const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "문서",
      description: "기본 문서",
      icon: "tabler/file-text",
      sections: [
        {
          id: "getting-started",
          title: "시작하기",
        },
        {
          id: "usage",
          title: "사용법",
        },
        {
          id: "features",
          title: "Features",
        },
        {
          id: "agents",
          title: "에이전트",
        },
        {
          id: "tools",
          title: "도구",
        },
        {
          id: "configuration",
          title: "설정",
        },
      ],
    },
  ],
};

export default sidebarNavData;
