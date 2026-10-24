import DownloadView, { downloadMetadata } from "@/views/download";

export const metadata = downloadMetadata("en");

export default function Page() {
  return <DownloadView lang="en" />;
}
