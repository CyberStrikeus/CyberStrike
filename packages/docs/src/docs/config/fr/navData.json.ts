/**
 * * This file is used to define the navigation links for the documentation site.
 */

// types
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "Documentation",
    link: "/docs/getting-started/",
  },
  {
    text: "Agents",
    link: "/docs/agents/",
  },
  {
    text: "Outils",
    link: "/docs/tools/",
  },
  {
    text: "GitHub",
    link: "https://github.com/CyberStrikeus/CyberStrike",
    newTab: true,
  },
];

export default navConfig;
