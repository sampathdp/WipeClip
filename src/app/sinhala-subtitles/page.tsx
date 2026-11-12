import FeatureView, { featureMetadata } from "@/views/feature";
import { SINHALA_SUBTITLES } from "@/lib/feature-pages";

export const metadata = featureMetadata(SINHALA_SUBTITLES);

export default function Page() {
  return <FeatureView page={SINHALA_SUBTITLES} />;
}
