import FeatureView, { featureMetadata } from "@/views/feature";
import { TRANSLATE_VIDEO } from "@/lib/feature-pages";

export const metadata = featureMetadata(TRANSLATE_VIDEO);

export default function Page() {
  return <FeatureView page={TRANSLATE_VIDEO} />;
}
