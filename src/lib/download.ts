/** Where the desktop installers are hosted. The video editor ships only as
 * the Windows and macOS app (src-tauri/, desktop/); the website markets it.
 * Windows points at the newest published release in the public releases repo
 * (fixed asset names from desktop/scripts/update-manifest.mjs). macOS stays
 * "Coming soon" until the app is signed and notarized: an unsigned app is
 * blocked by Gatekeeper. NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL / _MAC_URL override
 * the defaults; an empty URL shows "Coming soon".
 */
export const DOWNLOAD_PATH = "/download";

const LATEST_RELEASE = "https://github.com/sampathdp/wipeclip-releases/releases/latest/download";

export const DESKTOP_DOWNLOADS = [
  {
    os: "windows",
    label: "Windows",
    file: "64-bit installer (.exe)",
    requirements: "Windows 10 (21H2 or later) or Windows 11",
    url: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL ?? `${LATEST_RELEASE}/WipeClip-Windows-x64-setup.exe`,
    /** The installer isn't code-signed yet, so SmartScreen warns on first run. */
    note: 'New app, so your browser or Windows may warn you. In Edge, click ⋯ > Keep > Show more > Keep anyway. If Windows says "Windows protected your PC", click More info > Run anyway.',
  },
  {
    os: "mac",
    label: "macOS",
    file: "Disk image (.dmg)",
    requirements: "macOS 11 or later",
    // Set to `${LATEST_RELEASE}/WipeClip-macOS-AppleSilicon.dmg` once signed.
    url: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_URL ?? "",
    note: "",
  },
] as const;
