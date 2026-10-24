import LegalView, { legalMetadata } from "@/views/legal";

export const metadata = legalMetadata("dmca", "en");

export default function Page() {
  return <LegalView page="dmca" lang="en" />;
}
