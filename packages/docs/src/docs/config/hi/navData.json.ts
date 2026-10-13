/**
 * * This file is used to define the navigation links for the documentation site.
 */

// types
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "दस्तावेज़",
    link: "/hi/docs/getting-started/",
  },
  {
    text: "HackBrowser",
    link: "/hi/docs/features/hackbrowser/",
  },
  {
    text: "Vortex",
    link: "/hi/docs/features/vortex/",
  },
  {
    text: "Bolt",
    link: "/hi/docs/features/bolt/",
  },
  {
    text: "GitHub",
    link: "https://github.com/CyberStrikeus/CyberStrike",
    newTab: true,
  },
];

export default navConfig;
