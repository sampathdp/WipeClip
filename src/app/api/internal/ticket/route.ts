import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { firstTime, readTicket } from "@/lib/jobTicket";

/** Backend-only callback for job tickets (see src/lib/jobTicket.ts and
 * backend/app/tickets.py). JSON `{ action, ticket }`:
 *  - "claim": once per ticket, right before the backend runs the job.
 *    `{ ok: false }` means the ticket was already used.
 *  - "refund": gives a failed paid job's credits back; at most once per ticket.
 * Authenticated with the X-Internal-Process-Secret header.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  const given = request.headers.get("X-Internal-Process-Secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: string; ticket?: string } | null;
  const ticket = body?.ticket ? readTicket(body.ticket) : null;
  if (!ticket) return NextResponse.json({ detail: "Invalid ticket" }, { status: 400 });

  if (body?.action === "claim") {
    return NextResponse.json({ ok: await firstTime(`claim:${ticket.id}`) });
  }

  if (body?.action === "refund") {
    if (ticket.kind !== "process" || !ticket.userId || ticket.cost <= 0) return NextResponse.json({ ok: true });
    if (!(await firstTime(`refund:${ticket.id}`))) return NextResponse.json({ ok: true }); // already refunded
    if (!isSupabaseConfigured()) return NextResponse.json({ detail: "Accounts aren't configured" }, { status: 501 });
    const { error } = await createServiceClient().rpc("refund_credits", {
      p_user_id: ticket.userId,
      p_amount: ticket.cost,
      p_resolution: ticket.resolution,
    });
    if (error) {
      console.error("[ticket] refund failed", ticket.id, error.message);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ detail: "Unknown action" }, { status: 400 });
}
