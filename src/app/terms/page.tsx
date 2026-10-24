import LegalView, { legalMetadata } from "@/views/legal";

export const metadata = legalMetadata("terms", "en");

export default function Page() {
  return <LegalView page="terms" lang="en" />;
}
