/**
 * * This file is used to define the navigation links for the documentation site.
 */

// types
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "文档",
    link: "/docs/getting-started/",
  },
  {
    text: "HackBrowser",
    link: "/docs/features/hackbrowser/",
  },
  {
    text: "Vortex",
    link: "/docs/features/vortex/",
  },
  {
    text: "Bolt",
    link: "/docs/features/bolt/",
  },
  {
    text: "GitHub",
    link: "https://github.com/CyberStrikeus/CyberStrike",
    newTab: true,
  },
];

export default navConfig;
