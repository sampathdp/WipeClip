import LegalView, { legalMetadata } from "@/views/legal";

export const metadata = legalMetadata("privacy", "en");

export default function Page() {
  return <LegalView page="privacy" lang="en" />;
}
