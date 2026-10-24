import { accountMetadata, HistoryView } from "@/views/account";

export const metadata = accountMetadata("history", "en");

export default function Page() {
  return <HistoryView lang="en" />;
}
