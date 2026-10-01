import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

const KINDS = ["bug", "feature", "feedback"] as const;
type Kind = (typeof KINDS)[number];

const MAX_SUBJECT = 140;
const MAX_MESSAGE = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts a bug report, feature request or general feedback from the
 * /feedback page. Signed-out visitors can submit too (optionally leaving an
 * email so we can reply); signed-in submissions are tied to the account so
 * they show up under "Your requests" with their status. Written with the
 * service-role key - the feedback table has no insert policy, so the
 * browser can never write to it directly.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Feedback isn't configured yet." }, { status: 501 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 5 submissions/hour per user (or IP when signed out) - plenty for a real
  // report plus a follow-up, tight enough to stop the form being spammed.
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user?.id)}:feedback`, 5, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many submissions. Try again in a while." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const kind = body?.kind as Kind | undefined;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 500) : null;

  // Honeypot: a hidden field real visitors never fill in. Bots that do get
  // a fake success so they don't learn to skip it.
  if (typeof body?.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "Pick a feedback type." }, { status: 400 });
  }
  if (!subject || subject.length > MAX_SUBJECT) {
    return NextResponse.json({ error: `Add a short title (up to ${MAX_SUBJECT} characters).` }, { status: 400 });
  }
  if (message.length < 10 || message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `Describe it in 10 to ${MAX_MESSAGE} characters.` },
      { status: 400 }
    );
  }
  if (rawEmail && !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("feedback")
    .insert({
      user_id: user?.id ?? null,
      email: user?.email ?? (rawEmail || null),
      kind,
      subject,
      message,
      page_url: pageUrl,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    })
    .select("id, kind, subject, message, status, admin_reply, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Couldn't save your feedback. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}
