/** Where the desktop installers are hosted. The video editor ships only as
 * the Windows and macOS app (src-tauri/, desktop/); the website markets it.
 * Set the URLs once a signed release is published; while one is empty, its
 * download button shows "Coming soon" instead.
 */
export const DOWNLOAD_PATH = "/download";

export const DESKTOP_DOWNLOADS = [
  {
    os: "windows",
    label: "Windows",
    file: "64-bit installer (.exe)",
    requirements: "Windows 10 (21H2 or later) or Windows 11",
    url: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL ?? "",
  },
  {
    os: "mac",
    label: "macOS",
    file: "Disk image (.dmg)",
    requirements: "macOS 11 or later",
    url: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_URL ?? "",
  },
] as const;
