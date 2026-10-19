import { NextRequest, NextResponse, after } from "next/server";
import { getRequestAuth, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { escapeHtml, sendEmail } from "@/lib/email";

const KIND_LABEL = { bug: "Bug report", feature: "Feature request", feedback: "Feedback" } as const;

const KINDS = ["bug", "feature", "feedback"] as const;
type Kind = (typeof KINDS)[number];

const MAX_SUBJECT = 140;
const MAX_MESSAGE = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts a bug report, feature request or general feedback from the
 * /feedback page or the prompt under a tool's result (ToolFeedback, which
 * the desktop app also shows - hence CORS). Signed-out visitors can submit
 * too (optionally leaving an email so we can reply); signed-in submissions
 * are tied to the account so they show up under "Your requests" with their
 * status. Written with the service-role key - the feedback table has no
 * insert policy, so the browser can never write to it directly.
=======
 * /feedback page or the prompt under a tool's result (ToolFeedback).
 * Signed-out visitors can submit too (optionally leaving an
 * email so we can reply); signed-in submissions are tied to the account so
 * they show up under "Your requests" with their status. Written with the
 * service-role key - the feedback table has no insert policy, so the
 * browser can never write to it directly.

 */
export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Feedback isn't configured yet." }, { status: 501 });
  }

  const { user } = await getRequestAuth(request);

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
  // Set when sent from under a tool's result. Only shown in the team email -
  // the page URL already identifies the tool in the stored row.
  const tool = typeof body?.tool === "string" && /^[a-z0-9_]{1,40}$/.test(body.tool) ? body.tool : null;

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

  const contactEmail = user?.email ?? (rawEmail || null);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("feedback")
    .insert({
      user_id: user?.id ?? null,
      email: contactEmail,
      kind,
      subject,
      message,
      page_url: pageUrl,
      user_agent: userAgent,
    })
    .select("id, kind, subject, message, status, admin_reply, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Couldn't save your feedback. Please try again." }, { status: 500 });
  }

  // Notify the team after responding, so a slow or failing email provider
  // never delays or fails the user's submission - the row is already saved.
  const notifyTo = process.env.FEEDBACK_NOTIFY_EMAIL;
  if (notifyTo) {
    after(() => notifyTeam(notifyTo, { id: data.id, kind, subject, message, contactEmail, signedIn: Boolean(user), tool, pageUrl, userAgent }));
  }

  return NextResponse.json({ ok: true, item: data });
}

async function notifyTeam(
  to: string,
  f: {
    id: number;
    kind: Kind;
    subject: string;
    message: string;
    contactEmail: string | null;
    signedIn: boolean;
    tool: string | null;
    pageUrl: string | null;
    userAgent: string | null;
  }
) {
  const from = f.contactEmail ? `${f.contactEmail}${f.signedIn ? " (signed in)" : ""}` : "Anonymous visitor";
  const rows: [string, string][] = [
    ["Type", KIND_LABEL[f.kind]],
    ["From", from],
    ["Tool", f.tool ?? "-"],
    ["Page", f.pageUrl ?? "-"],
    ["Browser", f.userAgent ?? "-"],
    ["Feedback ID", `#${f.id}`],
  ];

  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    f.subject,
    "",
    f.message,
    "",
    f.contactEmail ? "Reply to this email to answer them directly." : "No contact email was left.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;max-width:600px">
      <h2 style="margin:0 0 4px">${escapeHtml(f.subject)}</h2>
      <table style="border-collapse:collapse;margin:12px 0;font-size:13px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${k}</td><td>${escapeHtml(v)}</td></tr>`
          )
          .join("")}
      </table>
      <div style="white-space:pre-wrap;border-left:3px solid #22d3ee;padding:8px 12px;background:#f8fafc">${escapeHtml(f.message)}</div>
      <p style="color:#64748b;font-size:12px;margin-top:16px">
        ${f.contactEmail ? "Reply to this email to answer them directly." : "No contact email was left."}
      </p>
    </div>`;

  await sendEmail({
    to,
    subject: `[WipeClip ${KIND_LABEL[f.kind]}] ${f.subject}`,
    text,
    html,
    replyTo: f.contactEmail ?? undefined,
  });
}
