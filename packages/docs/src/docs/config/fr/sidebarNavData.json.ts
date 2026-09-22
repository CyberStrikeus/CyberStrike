import type { DocsSidebarNavData } from "../types/configDataTypes";

/**
 * Combined sidebar navigation data for the French locale
 */
const sidebarNavData: DocsSidebarNavData = {
  /**
   * Documentation tabs configuration
   * These define the different top-level documentation section tabs
   */
  tabs: [
    {
      id: "main",
      title: "Documentation",
      description: "Documentation principale",
      icon: "tabler/file-text",
      // Ordered list of sidebar sections for the 'main' tab
      // The "id" of each section should match a folder in the docs content collection
      sections: [
        {
          id: "getting-started",
          title: "Commencer",
        },
        {
          id: "components",
          title: "Composants",
        },
        {
          id: "reference",
          title: "Référence",
        },
      ],
    },
    {
      id: "api",
      title: "Référence API",
      description: "Documentation de l'API",
      icon: "tabler/api-app",
      // Ordered list of sidebar sections for the 'api' tab
      sections: [
        {
          id: "endpoints",
          title: "Points de terminaison",
        },
        {
          id: "authentication",
          title: "Authentification",
        },
      ],
    },
    {
      id: "tutorials",
      title: "Tutoriels",
      description: "Tutoriels étape par étape",
      icon: "tabler/school",
      // Ordered list of sidebar sections for the 'tutorials' tab
      sections: [
        {
          id: "tips-and-tricks",
          title: "Conseils et astuces",
        },
      ],
    },
  ],
};

export default sidebarNavData;
