import Tooltip from "./Tooltip.astro";
import TooltipContent from "./TooltipContent.astro";
import TooltipTrigger from "./TooltipTrigger.astro";

export { Tooltip, TooltipContent, TooltipTrigger };

export default {
  Root: Tooltip,
  Trigger: TooltipTrigger,
  Content: TooltipContent,
};
