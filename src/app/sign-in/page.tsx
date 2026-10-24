import { accountMetadata, SignInView } from "@/views/account";

export const metadata = accountMetadata("signIn", "en");

export default function Page() {
  return <SignInView lang="en" />;
}
