/** Illustrative product mockups for /download, drawn with CSS only (no
 * screenshots to keep in sync). All decorative: every one is aria-hidden and
 * the page text says the same thing.
 */

function WindowChrome({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-hidden className={`overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.6)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-white/10 bg-slate-900/80 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 truncate font-mono text-[10px] text-slate-400">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** A fake app screen (sidebar, header, cards) used as recorded content. */
function FakeScreen() {
  return (
    <div className="flex h-full w-full bg-slate-100">
      <div className="w-[22%] space-y-1.5 bg-slate-800 p-2">
        <div className="h-1.5 w-3/4 rounded bg-slate-500" />
        <div className="h-1.5 w-1/2 rounded bg-slate-600" />
        <div className="h-1.5 w-2/3 rounded bg-cyan-400/70" />
        <div className="h-1.5 w-1/2 rounded bg-slate-600" />
      </div>
      <div className="flex-1 space-y-2 p-2.5">
        <div className="h-2 w-1/3 rounded bg-slate-300" />
        <div className="grid grid-cols-3 gap-1.5">
          <div className="h-8 rounded bg-white shadow-sm" />
          <div className="h-8 rounded bg-white shadow-sm" />
          <div className="h-8 rounded bg-white shadow-sm" />
        </div>
        <div className="h-1.5 w-5/6 rounded bg-slate-200" />
        <div className="h-1.5 w-2/3 rounded bg-slate-200" />
        <div className="flex justify-end pt-1">
          <div className="h-3.5 w-12 rounded bg-violet-500" />
        </div>
      </div>
    </div>
  );
}

function Cursor({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className={`drop-shadow ${className}`}>
      <path d="M4 2l16 9-7 2-3 7z" fill="white" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Hero: the editor with a recording zooming in on a click, and its tracks. */
export function EditorWindowMock() {
  return (
    <WindowChrome title="WipeClip - product-tour.wipeclip">
      <div className="p-4">
        <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/10">
          <div className="animate-focus-zoom h-full w-full" style={{ transformOrigin: "86% 78%" }}>
            <FakeScreen />
            <div className="absolute" style={{ left: "84%", top: "74%" }}>
              <span className="absolute -left-2 -top-2 h-6 w-6 rounded-full border-2 border-cyan-400 motion-safe:animate-ping" />
              <Cursor />
            </div>
          </div>
          <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-cyan-300">
            AUTO ZOOM 1.8×
          </span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
            Click Save to publish your changes
          </span>
          <span className="absolute right-2 top-2 rounded border border-white/20 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white">
            Ctrl + S
          </span>
        </div>

        <div className="mt-4 space-y-1.5 font-mono text-[9px] text-slate-400">
          <Track label="Zoom">
            <div className="absolute inset-y-0 left-[18%] w-[16%] rounded bg-cyan-400/40 ring-1 ring-cyan-300/60" />
            <div className="absolute inset-y-0 left-[58%] w-[22%] rounded bg-cyan-400/40 ring-1 ring-cyan-300/60" />
            {[22, 27, 61, 66, 74].map((x) => (
              <span key={x} className="absolute top-0 h-full w-px bg-cyan-200" style={{ left: `${x}%` }} />
            ))}
          </Track>
          <Track label="Screen">
            <div className="absolute inset-y-0 left-0 w-[46%] rounded bg-gradient-to-b from-violet-500/80 to-violet-500/50" />
            <div className="absolute inset-y-0 left-[47%] w-[53%] rounded bg-gradient-to-b from-violet-500/80 to-violet-500/50" />
          </Track>
          <Track label="Mic">
            <div className="absolute inset-0 flex items-center gap-[2px] overflow-hidden px-1">
              {Array.from({ length: 64 }, (_, i) => (
                <span key={i} className="w-[2px] shrink-0 rounded bg-emerald-400/80" style={{ height: `${20 + ((i * 37) % 70)}%` }} />
              ))}
            </div>
          </Track>
          <Track label="Captions">
            {[2, 20, 40, 63, 82].map((x) => (
              <div key={x} className="absolute inset-y-0 w-[16%] rounded bg-amber-300/40 ring-1 ring-amber-200/50" style={{ left: `${x}%` }} />
            ))}
          </Track>
        </div>
      </div>
    </WindowChrome>
  );
}

function Track({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-right">{label}</span>
      <div className="relative h-4 flex-1 rounded bg-white/5">{children}</div>
    </div>
  );
}

/** Recorder: source choice, separate tracks, and the floating mini player. */
export function RecorderMock() {
  const toggles = [
    { label: "System audio", on: true },
    { label: "Microphone", on: true },
    { label: "Webcam", on: true },
    { label: "Mouse & keyboard events", on: true },
  ];
  return (
    <div aria-hidden className="relative">
      <WindowChrome title="Record your screen">
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Source</p>
            <div className="grid grid-cols-3 gap-2">
              {["Screen", "Window", "Area"].map((s, i) => (
                <div
                  key={s}
                  className={`rounded-lg border p-2 text-center text-[10px] font-semibold ${i === 0 ? "border-cyan-400 bg-cyan-400/10 text-cyan-200" : "border-white/10 text-slate-300"}`}
                >
                  <div className={`mx-auto mb-1.5 h-6 w-full rounded ${i === 2 ? "border border-dashed border-slate-500" : "bg-slate-700"}`} />
                  {s}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {toggles.map((t) => (
              <div key={t.label} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 text-[11px] text-slate-200">
                {t.label}
                <span className="flex h-3.5 w-6 items-center justify-end rounded-full bg-cyan-500 px-0.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white" />
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <span className="text-[10px] text-slate-400">Saved to your disk as separate tracks</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-3 py-1 text-[11px] font-bold text-white">
            <span className="h-2 w-2 rounded-full bg-white" /> Record
          </span>
        </div>
      </WindowChrome>

      <div className="absolute -bottom-6 -right-2 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900 px-3 py-2 shadow-2xl sm:-right-6">
        <span className="h-2 w-2 rounded-full bg-rose-500 motion-safe:animate-pulse" />
        <span className="font-mono text-[11px] font-semibold text-white">00:42</span>
        {["Pause", "Marker", "Stop"].map((b) => (
          <span key={b} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Focus: recorded clicks become zoom suggestions on their own track. */
export function FocusMock() {
  return (
    <WindowChrome title="Focus">
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/10">
          <div className="h-full w-full scale-[1.7]" style={{ transformOrigin: "30% 35%" }}>
            <FakeScreen />
          </div>
          <div className="absolute" style={{ left: "44%", top: "52%" }}>
            <span className="absolute -left-3 -top-3 h-8 w-8 rounded-full border-2 border-amber-300 bg-amber-300/20" />
            <Cursor className="scale-150" />
          </div>
        </div>
        <div className="space-y-2 text-[11px] text-slate-200 sm:w-40">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Preset</p>
          {["Subtle", "Balanced", "Dynamic"].map((p, i) => (
            <div key={p} className={`rounded-lg px-3 py-1.5 ${i === 1 ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50" : "bg-white/5"}`}>
              {p}
            </div>
          ))}
          <div className="rounded-lg bg-white/5 px-3 py-1.5">Click rings · On</div>
          <div className="rounded-lg bg-white/5 px-3 py-1.5">Smooth cursor · On</div>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-3 font-mono text-[9px] text-slate-400">
        <div className="relative h-5 rounded bg-white/5">
          {[
            [8, 14],
            [31, 20],
            [62, 12],
            [80, 15],
          ].map(([l, w]) => (
            <div key={l} className="absolute inset-y-0 rounded bg-cyan-400/40 ring-1 ring-cyan-300/60" style={{ left: `${l}%`, width: `${w}%` }} />
          ))}
          {[10, 12, 15, 34, 38, 44, 64, 69, 83, 90].map((x) => (
            <span key={x} className="absolute -top-1 h-7 w-px bg-amber-300/80" style={{ left: `${x}%` }} />
          ))}
        </div>
        <p className="mt-2">4 zooms suggested from 10 clicks</p>
      </div>
    </WindowChrome>
  );
}

/** Review: on-device suggestions for pauses, dead time and retakes. */
export function ReviewMock() {
  const rows = [
    { tag: "Pause", tone: "bg-amber-400/20 text-amber-200", text: "3.4 s of silence at 0:18", action: "Cut" },
    { tag: "Dead time", tone: "bg-sky-400/20 text-sky-200", text: "No clicks or speech for 9 s at 1:02", action: "Cut" },
    { tag: "Retake", tone: "bg-fuchsia-400/20 text-fuchsia-200", text: "Same click sequence twice at 1:40", action: "Review" },
    { tag: "Clicks", tone: "bg-emerald-400/20 text-emerald-200", text: "Repeated clicks on one spot at 2:15", action: "Review" },
  ];
  return (
    <WindowChrome title="Tutorial - Review">
      <div className="space-y-2 p-5">
        {rows.map((r) => (
          <div key={r.text} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${r.tone}`}>{r.tag}</span>
            <span className="flex-1 truncate text-[11px] text-slate-200">{r.text}</span>
            <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] font-semibold text-white">{r.action}</span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 text-[10px] text-slate-400">
          <span>Analyzed on this computer</span>
          <span className="rounded-full bg-cyan-500 px-3 py-1 font-bold text-white">Cut all pauses</span>
        </div>
      </div>
    </WindowChrome>
  );
}

/** Captions, privacy masks and annotations over one frame. */
export function TutorialFrameMock() {
  return (
    <WindowChrome title="Captions · Privacy · Annotate">
      <div className="p-5">
        <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/10">
          <FakeScreen />
          <div className="absolute left-[30%] top-[12%] flex h-[14%] w-[34%] items-center justify-center rounded bg-slate-400/60 backdrop-blur-md">
            <span className="text-[9px] font-semibold text-white">Blurred</span>
          </div>
          <span className="absolute left-[24%] top-[33%] flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">1</span>
          <span className="absolute left-[55%] top-[33%] flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">2</span>
          <div className="absolute right-[6%] top-[66%] h-[18%] w-[22%] rounded-md border-2 border-rose-500" />
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white">
            Then open the settings panel
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="text-slate-400">Export subtitles:</span>
          {[".srt", ".vtt", ".txt"].map((f) => (
            <span key={f} className="rounded-full border border-white/15 px-2.5 py-0.5 font-mono font-semibold text-slate-200">
              {f}
            </span>
          ))}
          <span className="ml-auto text-slate-400">Chapters: 4</span>
        </div>
      </div>
    </WindowChrome>
  );
}
