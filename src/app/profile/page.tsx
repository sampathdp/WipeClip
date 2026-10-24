import { accountMetadata, ProfileView } from "@/views/account";

export const metadata = accountMetadata("profile", "en");

export default function Page() {
  return <ProfileView lang="en" />;
}
