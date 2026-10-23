/** Imported 3D LUTs (.cube files) for clip color.
 *
 * Preview: LutRenderer draws the clip's video frame through the LUT in
 * WebGL2 (a 3D texture, trilinear) onto a canvas that stands in for the
 * video element. Export: the LUT goes with the clip's look (resampled to
 * at most EXPORT_LUT_SIZE per side) and look.py composes it into the one
 * LUT ffmpeg applies - with trilinear interpolation, like the GPU. The LUT
 * runs first, then the filter preset, adjustments and curves.
 */

export interface CubeLut {
  size: number;
  /** RGB triplets, red fastest (the .cube order). */
  data: Float32Array;
}

export const EXPORT_LUT_SIZE = 25;

/** Parses a .cube file (3D; DOMAIN_MIN/MAX supported). */
export function parseCube(text: string): CubeLut {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === "LUT_3D_SIZE") size = parseInt(rest[0], 10);
    else if (key === "LUT_1D_SIZE") throw new Error("1D LUTs aren't supported - use a 3D .cube file.");
    else if (key === "DOMAIN_MIN") min = rest.map(Number);
    else if (key === "DOMAIN_MAX") max = rest.map(Number);
    else if (/^[-+.\d]/.test(key)) values.push(Number(key), Number(rest[0]), Number(rest[1]));
  }
  if (!(size >= 2 && size <= 128) || values.length !== size ** 3 * 3 || values.some((v) => !Number.isFinite(v))) {
    throw new Error("That file isn't a valid 3D .cube LUT.");
  }
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    data[i] = Math.min(1, Math.max(0, (values[i] - min[c]) / (max[c] - min[c] || 1)));
  }
  return { size, data };
}

/** Trilinear lookup of one color (0..1). */
export function sampleLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1;
  const f = [r, g, b].map((v) => Math.min(1, Math.max(0, v)) * n);
  const i0 = f.map((v) => Math.min(n - 1, Math.floor(v)));
  const t = f.map((v, k) => v - i0[k]);
  const out: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const dr = corner & 1;
    const dg = (corner >> 1) & 1;
    const db = (corner >> 2) & 1;
    const w = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
    if (!w) continue;
    const idx = ((i0[2] + db) * lut.size * lut.size + (i0[1] + dg) * lut.size + (i0[0] + dr)) * 3;
    out[0] += w * lut.data[idx];
    out[1] += w * lut.data[idx + 1];
    out[2] += w * lut.data[idx + 2];
  }
  return out;
}

/** The LUT at `size` points per side (trilinear). */
export function resampleLut(lut: CubeLut, size: number): CubeLut {
  if (size >= lut.size) return lut;
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const v = sampleLut(lut, r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = v[0];
        data[i++] = v[1];
        data[i++] = v[2];
      }
  return { size, data };
}

const parsed = new Map<string, Promise<CubeLut>>();

/** Parsed LUT of a source file, cached per source id. */
export function loadLut(id: string, file: () => Promise<File>): Promise<CubeLut> {
  let p = parsed.get(id);
  if (!p) {
    p = file().then(async (f) => parseCube(await f.text()));
    parsed.set(id, p);
    p.catch(() => parsed.delete(id));
  }
  return p;
}

/** A cached LUT, or null while it's still loading. */
const ready = new Map<string, CubeLut>();
export function lutNow(id: string, file: () => Promise<File>): CubeLut | null {
  const hit = ready.get(id);
  if (hit) return hit;
  void loadLut(id, file).then((l) => ready.set(id, l)).catch(() => {});
  return null;
}

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2((p.x + 1.0) / 2.0, (1.0 - p.y) / 2.0); gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D frame; uniform sampler3D lut; uniform float size; uniform float amount;
void main() {
  vec4 c = texture(frame, uv);
  // Texel centers: map 0..1 onto the first..last texel.
  vec3 at = c.rgb * ((size - 1.0) / size) + 0.5 / size;
  vec3 graded = texture(lut, at).rgb;
  color = vec4(mix(c.rgb, graded, amount), c.a);
}`;

/** WebGL2 renderer of video frames through a LUT, onto its own canvas. */
export class LutRenderer {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext | null;
  private lutTex: WebGLTexture | null = null;
  private frameTex: WebGLTexture | null = null;
  private current: CubeLut | null = null;
  private uSize: WebGLUniformLocation | null = null;
  private uAmount: WebGLUniformLocation | null = null;

  constructor() {
    this.gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false });
    const gl = this.gl;
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.gl = null;
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, "frame"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "lut"), 1);
    this.uSize = gl.getUniformLocation(prog, "size");
    this.uAmount = gl.getUniformLocation(prog, "amount");
    this.frameTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  get supported(): boolean {
    return !!this.gl;
  }

  /** Draws the video's current frame through `lut` at `amount` (0..1). */
  render(video: HTMLVideoElement, lut: CubeLut, amount: number): boolean {
    const gl = this.gl;
    if (!gl || video.readyState < 2 || !video.videoWidth) return false;
    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.current !== lut) {
      this.current = lut;
      this.lutTex ??= gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      // Half floats: always linearly filterable in WebGL2 (32-bit floats
      // need an extension), and ample precision for 0..1 colors.
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
      gl.uniform1f(this.uSize, lut.size);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1f(this.uAmount, amount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
