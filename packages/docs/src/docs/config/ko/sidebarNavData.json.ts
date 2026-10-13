import type { DocsSidebarNavData } from "../types/configDataTypes";

const sidebarNavData: DocsSidebarNavData = {
  tabs: [
    {
      id: "main",
      title: "문서",
      description: "주요 문서",
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
          id: "providers",
          title: "AI 공급자",
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
          id: "features",
          title: "기능",
        },
        {
          id: "configuration",
          title: "설정",
        },
        {
          id: "permissions",
          title: "권한",
        },
        {
          id: "cli",
          title: "CLI 참조",
        },
        {
          id: "slash-commands",
          title: "슬래시 명령어",
        },
        {
          id: "resources",
          title: "리소스",
        },
      ],
    },
  ],
};

export default sidebarNavData;
