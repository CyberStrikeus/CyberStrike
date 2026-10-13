/**
 * * This file is used to define the navigation links for the documentation site.
 */

// types
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "Documentação",
    link: "/pt/docs/getting-started/",
  },
  {
    text: "HackBrowser",
    link: "/pt/docs/features/hackbrowser/",
  },
  {
    text: "Vortex",
    link: "/pt/docs/features/vortex/",
  },
  {
    text: "Bolt",
    link: "/pt/docs/features/bolt/",
  },
  {
    text: "GitHub",
    link: "https://github.com/CyberStrikeus/CyberStrike",
    newTab: true,
  },
];

export default navConfig;
