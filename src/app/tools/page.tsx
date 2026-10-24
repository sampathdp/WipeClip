import ToolsView, { toolsMetadata } from "@/views/tools";

export const metadata = toolsMetadata("en");

export default function Page() {
  return <ToolsView lang="en" />;
}
