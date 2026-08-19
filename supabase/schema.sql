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
  free_credits int not null default 2,
  free_credits_reset_on date not null default current_date,
  paid_credits int not null default 0,
  ls_customer_id text,
  ls_subscription_id text,
  created_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id bigserial primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null, -- 'grant_free_daily' | 'grant_purchase' | 'consume' | 'refund'
  amount int not null, -- positive = credit added, negative = spent
  resolution text,
  ls_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists credit_transactions_user_id_idx on credit_transactions (user_id);

-- Dedupes Lemon Squeezy webhook deliveries (LS retries on non-2xx, and the
-- same event can otherwise be replayed) so a purchase is never granted twice.
create table if not exists processed_webhook_events (
  id text primary key,
  created_at timestamptz not null default now()
);

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
begin
  select free_credits, paid_credits into v_free, v_paid
  from profiles where id = p_user_id
  for update;

  if not found then
    return false;
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
  update profiles set paid_credits = paid_credits + p_amount where id = p_user_id;
  insert into credit_transactions (user_id, kind, amount, resolution)
  values (p_user_id, 'refund', p_amount, p_resolution);
end;
$$;

-- Grants purchased credits from a Lemon Squeezy webhook. Idempotent on
-- p_event_id: a replayed webhook for the same event is a silent no-op.
create or replace function grant_paid_credits(p_user_id uuid, p_amount int, p_event_id text, p_plan text default null)
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
      plan = coalesce(p_plan, plan)
  where id = p_user_id;

  insert into credit_transactions (user_id, kind, amount, ls_event_id)
  values (p_user_id, 'grant_purchase', p_amount, p_event_id);
end;
$$;

alter table profiles enable row level security;
alter table credit_transactions enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid() = id);

create policy "read own transactions" on credit_transactions
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated users on purpose:
-- all writes go through the SECURITY DEFINER functions above, or the
-- service-role key (webhook handler), never directly from the client.
