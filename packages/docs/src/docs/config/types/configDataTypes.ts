// site data types

export type Social = {
  social: string;
  link: string;
  icon: string;
  disabled?: boolean;
};

export type DocsSiteData = {
  title: string;
  description: string;
  navSocials: Social[] | undefined;
  footerSocials: Social[] | undefined;
  defaultImage: {
    src: string;
    alt: string;
  };
  author: {
    name: string;
    email: string;
    twitter: string; // used for twitter cards when sharing a blog post on twitter
  };
};

// --------------------------------------------------------
// nav data types
export interface navLinkItem {
  text: string;
  link: string;
  newTab?: boolean; // adds target="_blank" rel="noopener noreferrer" to link
}

export type navItem = navLinkItem;

// --------------------------------------------------------
// site settings types
export interface DocsSiteSettingsProps {
  useViewTransitions?: boolean;
  copyLinkButtons?: boolean;
  pagination?: boolean;
  docsRoute?: string;
}

// --------------------------------------------------------
// documentation section types
export interface DocsSection {
  /**
   * Unique identifier for the section. This should match the folder name under src/data/docs/
   */
  id: string;
  /**
   * Display title for the section
   */
  title: string;
}

/**
 * Configuration for a documentation tab
 */
export interface DocsTab {
  /**
   * Unique identifier for the tab
   */
  id: string;
  /**
   * Display title for the tab
   */
  title: string;
  /**
   * Description of the tab (optional)
   */
  description?: string;
  /**
   * Icon for the tab (optional)
   */
  icon?: string;
  /**
   * Ordered list of sidebar sections for this tab
   * The order determines the display order in navigation
   */
  sections: DocsSection[];
}

export interface DocsSidebarNavData {
  tabs: DocsTab[];
}

// --------------------------------------------------------
// testimonial data types
export interface TestimonialItem {
  avatar: ImageMetadata; // an imported image
  name: string;
  title: string;
  testimonial: string;
}
