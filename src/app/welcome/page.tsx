import { accountMetadata, WelcomeView } from "@/views/account";

export const metadata = accountMetadata("welcome", "en");

export default function Page() {
  return <WelcomeView lang="en" />;
}
