import ToolView, { toolMetadata } from "@/views/tool";

export const metadata = toolMetadata("sharpenImage", "en");

export default function Page() {
  return <ToolView tool="sharpenImage" lang="en" />;
}
