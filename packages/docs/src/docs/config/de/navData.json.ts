/**
 * * This file is used to define the navigation links for the documentation site.
 */

// types
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "Dokumentation",
    link: "/de/docs/getting-started/",
  },
  {
    text: "HackBrowser",
    link: "/de/docs/features/hackbrowser/",
  },
  {
    text: "Vortex",
    link: "/de/docs/features/vortex/",
  },
  {
    text: "Bolt",
    link: "/de/docs/features/bolt/",
  },
  {
    text: "GitHub",
    link: "https://github.com/CyberStrikeus/CyberStrike",
    newTab: true,
  },
];

export default navConfig;
