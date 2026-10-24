import LegalView, { legalMetadata } from "@/views/legal";

export const metadata = legalMetadata("refund", "en");

export default function Page() {
  return <LegalView page="refund" lang="en" />;
}
