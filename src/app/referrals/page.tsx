import { accountMetadata, ReferralsView } from "@/views/account";

export const metadata = accountMetadata("referrals", "en");

export default function Page() {
  return <ReferralsView lang="en" />;
}
