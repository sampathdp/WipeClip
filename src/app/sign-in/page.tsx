import type { Metadata } from "next";
import SignInClient from "./SignInClient";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your WipeClip.co account.",
  alternates: { canonical: "/sign-in" },
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return <SignInClient />;
}
