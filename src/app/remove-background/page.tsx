import ToolView, { toolMetadata } from "@/views/tool";

export const metadata = toolMetadata("removeBackground", "en");

export default function Page() {
  return <ToolView tool="removeBackground" lang="en" />;
}
