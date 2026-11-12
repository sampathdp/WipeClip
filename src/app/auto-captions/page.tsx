import FeatureView, { featureMetadata } from "@/views/feature";
import { AUTO_CAPTIONS } from "@/lib/feature-pages";

export const metadata = featureMetadata(AUTO_CAPTIONS);

export default function Page() {
  return <FeatureView page={AUTO_CAPTIONS} />;
}
