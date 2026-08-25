import VideoCompareSlider from "@/components/VideoCompareSlider";
import ImageCompareSlider from "@/components/ImageCompareSlider";

export default function BeforeAfterComparison({
  beforeMedia,
  afterMedia,
  mediaType,
}: {
  beforeMedia: string;
  afterMedia: string;
  mediaType: "video" | "image";
}) {
  return mediaType === "image" ? (
    <ImageCompareSlider beforeSrc={beforeMedia} afterSrc={afterMedia} />
  ) : (
    <VideoCompareSlider beforeSrc={beforeMedia} afterSrc={afterMedia} />
  );
}
