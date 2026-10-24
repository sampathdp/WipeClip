import FeedbackView, { feedbackMetadata } from "@/views/feedback";

export const metadata = feedbackMetadata("en");

export default function Page() {
  return <FeedbackView lang="en" />;
}
