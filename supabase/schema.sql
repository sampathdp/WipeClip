-- WipeClip.io credit ledger schema. Run this once in the Supabase SQL editor
-- (Project -> SQL Editor -> New query) after creating the project.
--
-- Model (see the pricing-strategy doc): every account gets 2 free credits
-- that reset daily (don't roll over); purchased/subscription credits never
-- expire and are spent second. 720p=1 credit, 1080p=2, 4K=4.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null default 'free', -- 'free' | 'starter' | 'pro'
  -- When a Starter/Pro 30-day pass runs out; the app reads an expired pass
  -- as 'free' (src/lib/plan.ts). Null = no expiry.
  plan_expires_at timestamptz,
  free_credits int not null default 2,
  free_credits_reset_on date not null default current_date,
  paid_credits int not null default 0,
  ls_customer_id text,
  ls_subscription_id text,
  -- Referral program: this user's own shareable code, and who referred
  -- them (set at most once - see claim_referral below). Both null
  -- until first touched; referral_code is generated lazily by
  -- ensure_referral_code() on a user's first visit to /referrals rather
  -- than at signup, so most accounts never pay for a code they don't use.
  referral_code text unique,
  referred_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- Additive - safe to re-run against a database provisioned before the
-- referral columns existed (create table if not exists above is a no-op on
-- an existing table).
alter table profiles add column if not exists referral_code text unique;
alter table profiles add column if not exists referred_by uuid references profiles (id);
alter table profiles add column if not exists plan_expires_at timestamptz;
-- Tester accounts (friends trying the product), switched on from the admin
-- panel: AI jobs run without spending credits. The admin action also sets
-- the plan to Pro with no expiry for the editor features.
alter table profiles add column if not exists tester_access boolean not null default false;

create table if not exists credit_transactions (
  id bigserial primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null, -- 'grant_free_daily' | 'grant_purchase' | 'consume' | 'refund'
  amount int not null, -- positive = credit added, negative = spent
  resolution text,
  ls_event_id text,
  -- 'video' | 'image', and the uploaded filename - both nullable and set
  -- after the fact by the /api/process* routes (a follow-up update, not
  -- part of consume_credits' own insert - see Job History). Purely
  -- descriptive, never read by the RPCs themselves.
  tool text,
  filename text,
  created_at timestamptz not null default now()
);
create index if not exists credit_transactions_user_id_idx on credit_transactions (user_id);

-- Additive - safe to re-run against a database that already has this table
-- from before these two columns existed (create table if not exists above
-- is a no-op on an existing table, so the columns must be added explicitly).
alter table credit_transactions add column if not exists tool text;
alter table credit_transactions add column if not exists filename text;

-- Dedupes payment webhook deliveries (Payments.lk retries on non-2xx, and
-- the same event can otherwise be replayed) so a purchase is never granted
-- twice.
create table if not exists processed_webhook_events (
  id text primary key,
  created_at timestamptz not null default now()
);

-- One row per checkout started from /api/checkout. Payments.lk checkouts
-- carry no metadata, so this row's id is sent as the checkout's `reference`
-- and the webhook reads it back to know who to credit, with what, and for
-- how much - all fixed server side when the checkout was created.
create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  plan text not null,
  credits int not null,
  amount_cents int not null, -- whole cents of `currency`
  status text not null default 'open', -- 'open' | 'paid' | 'failed' | 'expired' | 'refunded' | 'charged_back'
  checkout_id text unique, -- Payments.lk checkout id, or Paddle transaction id (txn_...)
  payment_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payment_orders_user_id_idx on payment_orders (user_id);

-- Additive - safe to re-run. Sri Lanka pays through Payments.lk in LKR,
-- everyone else through Paddle in USD (see src/lib/checkoutGateway.ts).
alter table payment_orders add column if not exists provider text not null default 'payments_lk'; -- 'payments_lk' | 'paddle'
alter table payment_orders add column if not exists currency text not null default 'LKR';
-- The account's Paddle customer (ctm_...), recorded by the Paddle webhook
-- on the first purchase; reused for later checkouts and passed to Paddle
-- Retain as pwCustomer.
alter table profiles add column if not exists paddle_customer_id text;

-- Marketing email opt-out. Set by the unsubscribe link in every newsletter
-- (/unsubscribe and the one-click /api/unsubscribe); scripts/send-newsletter.ts
-- never sends to an account with marketing_opt_out = true. Service and
-- account emails (receipts, password resets) are not affected.
alter table profiles add column if not exists marketing_opt_out boolean not null default false;
alter table profiles add column if not exists marketing_opt_out_at timestamptz;
-- The promotion code an order was discounted with (src/lib/promo.ts), so
-- each account can use a promotion once.
alter table payment_orders add column if not exists promo_code text;

-- Visitor country (ISO 3166 alpha-2, from the edge's geo header - see
-- src/lib/checkoutGateway.ts). profiles.country is the latest one seen for
-- the account (sign-in, balance checks, checkout); payment_orders.country is
-- where the buyer was when they pressed the pay button. Null = unknown.
alter table profiles add column if not exists country text;
alter table profiles add column if not exists country_updated_at timestamptz;
alter table payment_orders add column if not exists country text;
create index if not exists payment_orders_created_at_idx on payment_orders (created_at desc);
create index if not exists payment_orders_country_idx on payment_orders (country);

-- Who each newsletter campaign has gone to (src/lib/newsletter.ts), so the
-- admin panel and scripts/send-newsletter.ts can send in slices and resume
-- without anyone getting the same campaign twice.
create table if not exists newsletter_sends (
  campaign text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (campaign, user_id)
);
-- Recipients come from auth.users, and older accounts can lack a profiles
-- row, so the key points at the account itself (it used to be profiles).
alter table newsletter_sends drop constraint if exists newsletter_sends_user_id_fkey;
alter table newsletter_sends add constraint newsletter_sends_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
alter table newsletter_sends enable row level security;

-- The live promotion (src/lib/promo.ts), edited at /admin/promotion. A
-- single row (id is always 1). Read and written only with the service-role key.
create table if not exists promo_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  code text,
  percent int check (percent between 1 and 99),
  plans text[] not null default '{}',
  ends_at timestamptz,
  -- Only accounts created before this get the discount ("current users"). Null = any account.
  accounts_before timestamptz,
  -- The matching Paddle discount (dsc_...), created and kept in sync by the admin page.
  paddle_discount_id text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table promo_settings enable row level security;
-- Removed: codes are entered on the pricing page instead, where each account
-- can use a promotion only once (Paddle can only cap total redemptions).
alter table promo_settings drop column if exists paddle_coupon;

-- User-submitted bug reports, feature requests and general feedback from
-- /feedback. Anyone can submit (user_id is null for signed-out visitors,
-- who may leave a contact email instead); signed-in users can read back
-- their own rows to see the status of what they reported. Inserts go
-- through /api/feedback with the service-role key, never the client.
-- status/admin_reply are updated by hand from the Supabase dashboard.
create table if not exists feedback (
  id bigserial primary key,
  user_id uuid references profiles (id) on delete set null,
  email text,
  kind text not null, -- 'bug' | 'feature' | 'feedback'
  subject text not null,
  message text not null,
  page_url text,
  user_agent text,
  status text not null default 'open', -- 'open' | 'in_progress' | 'resolved' | 'closed'
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_user_id_idx on feedback (user_id);
create index if not exists feedback_status_idx on feedback (status, created_at desc);

-- New auth user -> profile row, so every signed-up account has a balance
-- from the start without a separate onboarding step.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Applies the lazy daily free-credit reset without spending anything -
-- used when just reading the balance (e.g. for display), so consume_credits
-- doesn't need a zero-amount call that would log a no-op transaction row.
create or replace function ensure_daily_reset(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update profiles
  set free_credits = 2, free_credits_reset_on = current_date
  where id = p_user_id and free_credits_reset_on < current_date;
end;
$$;

-- Atomically checks + spends credits (free balance first, then paid).
-- Returns true if there was enough balance and it was spent, false if not
-- (caller should treat false as "insufficient credits", not an error).
create or replace function consume_credits(p_user_id uuid, p_amount int, p_resolution text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_free int;
  v_paid int;
  v_from_free int;
  v_from_paid int;
  v_tester boolean;
begin
  select free_credits, paid_credits, tester_access into v_free, v_paid, v_tester
  from profiles where id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Tester accounts run free: logged at 0 so Job History still lists the job.
  if v_tester then
    insert into credit_transactions (user_id, kind, amount, resolution)
    values (p_user_id, 'consume', 0, p_resolution);
    return true;
  end if;

  -- Lazy daily reset: only actually touches the row on a user's first
  -- request of a new day, rather than needing a scheduled job.
  if (select free_credits_reset_on from profiles where id = p_user_id) < current_date then
    v_free := 2;
    update profiles set free_credits = 2, free_credits_reset_on = current_date where id = p_user_id;
  end if;

  if v_free + v_paid < p_amount then
    return false;
  end if;

  v_from_free := least(v_free, p_amount);
  v_from_paid := p_amount - v_from_free;

  update profiles
  set free_credits = free_credits - v_from_free,
      paid_credits = paid_credits - v_from_paid
  where id = p_user_id;

  insert into credit_transactions (user_id, kind, amount, resolution)
  values (p_user_id, 'consume', -p_amount, p_resolution);

  return true;
end;
$$;

-- Always refunds into paid_credits (so a refund never gets wiped by the
-- next midnight reset regardless of what it was originally spent from).
create or replace function refund_credits(p_user_id uuid, p_amount int, p_resolution text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  -- Tester jobs were never charged (see consume_credits), so nothing to refund.
  if exists (select 1 from profiles where id = p_user_id and tester_access) then
    return;
  end if;
  update profiles set paid_credits = paid_credits + p_amount where id = p_user_id;
  insert into credit_transactions (user_id, kind, amount, resolution)
  values (p_user_id, 'refund', p_amount, p_resolution);
end;
$$;

-- Grants purchased credits from a Payments.lk webhook. Idempotent on
-- p_event_id: a replayed webhook for the same payment is a silent no-op.
-- p_plan_days, with p_plan, sets the tier for that many days from now (or
-- from the current expiry, if the same tier is still running, so buying
-- again early extends the pass rather than wasting the rest of it).
drop function if exists grant_paid_credits(uuid, int, text, text);
create or replace function grant_paid_credits(p_user_id uuid, p_amount int, p_event_id text, p_plan text default null, p_plan_days int default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into processed_webhook_events (id) values (p_event_id)
  on conflict (id) do nothing;

  if not found then
    return; -- already processed this exact event
  end if;

  update profiles
  set paid_credits = paid_credits + p_amount,
      plan_expires_at = case
        when p_plan is null or p_plan_days is null then plan_expires_at
        when plan = p_plan and plan_expires_at > now() then plan_expires_at + make_interval(days => p_plan_days)
        else now() + make_interval(days => p_plan_days)
      end,
      plan = coalesce(p_plan, plan)
  where id = p_user_id;

  insert into credit_transactions (user_id, kind, amount, ls_event_id)
  values (p_user_id, 'grant_purchase', p_amount, p_event_id);
end;
$$;

-- Takes back what a purchase granted when it is refunded or charged back.
-- Idempotent on p_event_id, like grant_paid_credits. Credits already spent
-- can't be recovered, so the balance stops at 0 rather than going negative.
-- p_end_plan ends the pass now (a full refund or chargeback); a partial
-- refund only takes back its share of the credits.
create or replace function revoke_paid_credits(p_user_id uuid, p_amount int, p_event_id text, p_end_plan boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into processed_webhook_events (id) values (p_event_id)
  on conflict (id) do nothing;

  if not found then
    return; -- already processed this exact event
  end if;

  update profiles
  set paid_credits = greatest(paid_credits - p_amount, 0),
      plan = case when p_end_plan then 'free' else plan end,
      plan_expires_at = case when p_end_plan then now() else plan_expires_at end
  where id = p_user_id;

  insert into credit_transactions (user_id, kind, amount, ls_event_id)
  values (p_user_id, 'revoke_purchase', -p_amount, p_event_id);
end;
$$;

-- Returns the caller's own referral code, generating one on first call
-- (retrying on the rare collision - referral_code has a unique constraint).
-- Idempotent: a user who already has a code just gets it back unchanged.
create or replace function ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_attempt int := 0;
begin
  select referral_code into v_code from profiles where id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_code := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    begin
      update profiles set referral_code = v_code where id = p_user_id and referral_code is null;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not generate a unique referral code';
      end if;
    end;
  end loop;

  select referral_code into v_code from profiles where id = p_user_id;
  return v_code;
end;
$$;

-- Credits both the referee (p_referee) and whoever owns p_referrer_code a
-- fixed bonus, at most once per referee (referred_by is set exactly once -
-- the update's `where referred_by is null` is what makes a repeat or
-- concurrent claim a no-op rather than a double grant). Returns false
-- rather than raising for every "this claim shouldn't go through" case
-- (unknown code, self-referral, already-referred, race lost) so the
-- calling route can treat it as "nothing happened", not an error.
create or replace function claim_referral(p_referee uuid, p_referrer_code text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_referrer uuid;
  v_bonus constant int := 5;
begin
  select id into v_referrer from profiles where referral_code = p_referrer_code;
  if v_referrer is null or v_referrer = p_referee then
    return false;
  end if;

  update profiles set referred_by = v_referrer where id = p_referee and referred_by is null;
  if not found then
    return false;
  end if;

  update profiles set paid_credits = paid_credits + v_bonus where id in (v_referrer, p_referee);

  insert into credit_transactions (user_id, kind, amount)
  values (v_referrer, 'grant_referral', v_bonus), (p_referee, 'grant_referral', v_bonus);

  return true;
end;
$$;

-- Best-effort tagging of the transaction row consume_credits() just
-- inserted, with which tool ran and the source filename - purely
-- descriptive metadata for the Job History view, not billing-critical
-- (consume_credits itself doesn't take these, so its return contract for
-- existing callers is unchanged). Picks the caller's own most recent
-- untagged 'consume' row rather than a passed-in id, since consume_credits
-- only returns a boolean today.
create or replace function tag_last_transaction(p_user_id uuid, p_tool text, p_filename text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update credit_transactions
  set tool = p_tool, filename = p_filename
  where id = (
    select id from credit_transactions
    where user_id = p_user_id and kind = 'consume' and tool is null
    order by id desc
    limit 1
  );
end;
$$;

alter table profiles enable row level security;
alter table credit_transactions enable row level security;
-- No policies: only the service-role key (checkout route, webhook) touches it.
alter table payment_orders enable row level security;
alter table feedback enable row level security;
-- No policies: only the SECURITY DEFINER grant/revoke functions touch it.
alter table processed_webhook_events enable row level security;

drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles
  for select using (auth.uid() = id);

drop policy if exists "read own transactions" on credit_transactions;
create policy "read own transactions" on credit_transactions
  for select using (auth.uid() = user_id);

drop policy if exists "read own feedback" on feedback;
create policy "read own feedback" on feedback
  for select using (auth.uid() = user_id);

-- Everything the admin dashboard (/admin/analytics) charts, aggregated here
-- so the page never pulls raw rows: per-day signups and checkouts over the
-- last p_days days (UTC), checkouts and revenue per country and currency in
-- that window, order statuses in that window, and accounts per country of
-- all time. Read-only; service role only (see the revoke block below).
create or replace function admin_dashboard_stats(p_days int default 30)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with bounds as (
    select (current_date - (greatest(1, least(p_days, 366)) - 1))::date as since
  ),
  days as (
    select d::date as day from bounds, generate_series(bounds.since, current_date, interval '1 day') d
  ),
  win as (
    select o.* from payment_orders o, bounds where o.created_at >= bounds.since
  )
  select jsonb_build_object(
    'since', (select since from bounds),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object('day', days.day, 'count', coalesce(s.n, 0)) order by days.day), '[]')
      from days
      left join (
        select created_at::date as day, count(*) as n from profiles, bounds where created_at >= bounds.since group by 1
      ) s on s.day = days.day
    ),
    'checkouts', (
      select coalesce(jsonb_agg(jsonb_build_object('day', days.day, 'started', coalesce(c.started, 0), 'paid', coalesce(c.paid, 0)) order by days.day), '[]')
      from days
      left join (
        select created_at::date as day, count(*) as started, count(*) filter (where status = 'paid') as paid from win group by 1
      ) c on c.day = days.day
    ),
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object('day', r.day, 'currency', r.currency, 'cents', r.cents) order by r.day), '[]')
      from (
        select paid_at::date as day, currency, sum(amount_cents) as cents
        from payment_orders, bounds
        where status = 'paid' and paid_at >= bounds.since
        group by 1, 2
      ) r
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'country', c.country, 'started', c.started, 'paid', c.paid, 'currency', c.currency, 'cents', c.cents
      ) order by c.started desc), '[]')
      from (
        select coalesce(country, '') as country, currency, count(*) as started,
               count(*) filter (where status = 'paid') as paid,
               coalesce(sum(amount_cents) filter (where status = 'paid'), 0) as cents
        from win group by 1, 2
      ) c
    ),
    'statuses', (
      select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n) order by s.n desc), '[]')
      from (select status, count(*) as n from win group by 1) s
    ),
    'users_by_country', (
      select coalesce(jsonb_agg(jsonb_build_object('country', u.country, 'count', u.n) order by u.n desc), '[]')
      from (select coalesce(country, '') as country, count(*) as n from profiles group by 1) u
    )
  );
$$;

-- No insert/update/delete policies for authenticated users on purpose:
-- all writes go through the SECURITY DEFINER functions above, or the
-- service-role key (webhook handler), never directly from the client.

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- Supabase exposes every public-schema function to anon/authenticated over
-- its RPC endpoint. Without this block, any signed-in user could call
-- refund_credits or grant_paid_credits directly with the browser's own
-- anon key and mint themselves unlimited credits, bypassing Payments.lk
-- entirely - these are SECURITY DEFINER, so they run with elevated
-- privilege regardless of RLS on the tables they touch. All of the below
-- are only ever called from server code (API routes / the webhook handler)
-- using the service-role key, so anon/authenticated get nothing.
revoke execute on function ensure_daily_reset(uuid) from public, anon, authenticated;
revoke execute on function consume_credits(uuid, int, text) from public, anon, authenticated;
revoke execute on function refund_credits(uuid, int, text) from public, anon, authenticated;
revoke execute on function grant_paid_credits(uuid, int, text, text, int) from public, anon, authenticated;
revoke execute on function revoke_paid_credits(uuid, int, text, boolean) from public, anon, authenticated;
revoke execute on function tag_last_transaction(uuid, text, text) from public, anon, authenticated;
revoke execute on function ensure_referral_code(uuid) from public, anon, authenticated;
revoke execute on function claim_referral(uuid, text) from public, anon, authenticated;

grant execute on function ensure_daily_reset(uuid) to service_role;
grant execute on function consume_credits(uuid, int, text) to service_role;
grant execute on function refund_credits(uuid, int, text) to service_role;
grant execute on function grant_paid_credits(uuid, int, text, text, int) to service_role;
grant execute on function revoke_paid_credits(uuid, int, text, boolean) to service_role;
grant execute on function tag_last_transaction(uuid, text, text) to service_role;
grant execute on function ensure_referral_code(uuid) to service_role;
grant execute on function claim_referral(uuid, text) to service_role;
revoke execute on function admin_dashboard_stats(int) from public, anon, authenticated;
grant execute on function admin_dashboard_stats(int) to service_role;
