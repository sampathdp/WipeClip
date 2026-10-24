import ToolView, { toolMetadata } from "@/views/tool";

export const metadata = toolMetadata("extractVideoFrame", "en");

export default function Page() {
  return <ToolView tool="extractVideoFrame" lang="en" />;
}
