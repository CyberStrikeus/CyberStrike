import Tabs from "./Tabs.astro";
import TabsContent from "./TabsContent.astro";
import TabsList from "./TabsList.astro";
import TabsTrigger from "./TabsTrigger.astro";

export { Tabs, TabsContent, TabsList, TabsTrigger };

export default {
  Root: Tabs,
  Content: TabsContent,
  List: TabsList,
  Trigger: TabsTrigger,
};
