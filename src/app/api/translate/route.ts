import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

/** Translates a video's transcript sentences for voice translation in the
 * desktop app (backend/app/pipeline/dub.py says them in the speaker's voice).
 * Takes JSON `{ from, to, sentences: string[] }` and answers
 * `{ sentences: string[] }`, one translation per sentence, same order. Only
 * the text comes here - the audio and the voice stay on the user's machine.
 * Signed-in callers only, rate limited: every call costs model tokens.
 */

const LANGUAGES: Record<string, string> = { si: "Sinhala", ta: "Tamil", hi: "Hindi", kn: "Kannada", te: "Telugu", en: "English" };
const MAX_SENTENCES = 600;
const MAX_CHARS = 60_000; // about an hour of speech

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || !isSupabaseConfigured()) {
    return errorResponse("not_configured", "Voice translation isn't available yet.", 501);
  }
  const { user } = await getRequestAuth(request);
  if (!user) return errorResponse("auth_required", "Sign in to translate the voice.", 401);
  // 30 translations an hour per account: a video takes one.
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:translate`, 30, 60 * 60 * 1000))) {
    return errorResponse("rate_limited", "Too many translations. Try again in a while.", 429);
  }

  const body = await request.json().catch(() => null);
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  const sentences: unknown[] = Array.isArray(body?.sentences) ? body.sentences : [];
  if (!LANGUAGES[from] || !LANGUAGES[to] || from === to) return errorResponse("bad_request", "Unsupported languages.", 400);
  if (sentences.length === 0 || sentences.length > MAX_SENTENCES || !sentences.every((s) => typeof s === "string")) {
    return errorResponse("bad_request", "Invalid sentences.", 400);
  }
  const texts = sentences as string[];
  if (texts.reduce((n, s) => n + s.length, 0) > MAX_CHARS) {
    return errorResponse("too_long", "This video is too long to translate in one go.", 413);
  }

  const numbered = texts.map((s, i) => `${i + 1}. ${s.replace(/\s+/g, " ").trim()}`).join("\n");
  const client = new Anthropic();
  let message;
  try {
    message = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { sentences: { type: "array", items: { type: "string" } } },
            required: ["sentences"],
            additionalProperties: false,
          },
        },
      },
      system:
        `You translate the transcript of a video from ${LANGUAGES[from]} to ${LANGUAGES[to]} so it can be spoken again as a voiceover. ` +
        "The transcript was made by speech recognition, so it can have misheard words and missing punctuation: translate what the speaker meant. " +
        `Write natural spoken ${LANGUAGES[to]} that takes about as long to say as the original, keeping names, numbers and brand names. ` +
        "Answer with exactly one translation per numbered line, in the same order, without the numbers. " +
        "A line that is only noise or a fragment gets its best short translation, or an empty string.",
      messages: [{ role: "user", content: numbered }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return errorResponse("busy", "Translation is busy right now. Try again in a minute.", 503);
    if (err instanceof Anthropic.APIError) {
      console.error("translate: model call failed", err.status, err.message);
      return errorResponse("translate_failed", "The translation failed. Try again.", 502);
    }
    throw err;
  }
  if (message.stop_reason === "refusal") return errorResponse("refused", "This transcript couldn't be translated.", 422);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    return errorResponse("translate_failed", "The translation came back incomplete. Try again.", 502);
  }
  const result = (out as { sentences?: unknown })?.sentences;
  if (!Array.isArray(result) || result.length !== texts.length || !result.every((s) => typeof s === "string")) {
    return errorResponse("translate_failed", "The translation didn't match the transcript. Try again.", 502);
  }
  return NextResponse.json({ sentences: result });
}
