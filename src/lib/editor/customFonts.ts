/** Fonts the user uploads (a "font" source). Text using one has the font
 * key `src:<source id>`; the font is registered with the page under a
 * family name of its own, so the rasterizer draws with it like any other -
 * and the export, which uses the rasterized PNG, needs nothing more. */

export const FONT_EXT: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };

export const customFontKey = (sourceId: string) => `src:${sourceId}`;
export const customFontFamily = (sourceId: string) => `wc-font-${sourceId.replace(/[^\w-]/g, "")}`;

export function fontSourceId(fontKey: string): string | null {
  return fontKey.startsWith("src:") ? fontKey.slice(4) : null;
}

/** The upload with a font media type from its extension (browsers often
 * leave font files untyped), or null if it isn't a supported font. */
export function asFontFile(file: File): File | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = FONT_EXT[ext];
  return type ? new File([file], file.name, { type }) : null;
}

const registered = new Map<string, Promise<void>>();

/** Registers font source `id` with the page (once). Rejects if the file
 * isn't a font the browser can use. */
export function registerFont(id: string, file: () => Promise<File>): Promise<void> {
  let p = registered.get(id);
  if (!p) {
    p = file()
      .then((f) => f.arrayBuffer())
      .then(async (bytes) => {
        const face = new FontFace(customFontFamily(id), bytes);
        await face.load();
        document.fonts.add(face);
      });
    registered.set(id, p);
    p.catch(() => registered.delete(id));
  }
  return p;
}

/** Waits for a text style's custom font, if it has one. */
export function fontReady(fontKey: string): Promise<void> {
  const id = fontSourceId(fontKey);
  return (id && registered.get(id)) || Promise.resolve();
}
