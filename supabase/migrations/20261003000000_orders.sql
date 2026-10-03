-- Paid famous plots, bought through Dodo Payments.
--
-- Buying a famous plot creates an order holding the claim the buyer filled in, then sends
-- them to a Dodo checkout. The `dodo-webhook` edge function turns the order into a claim
-- once Dodo reports the payment as succeeded. Only the edge functions (secret key) touch
-- this table; visitors have no access at all.

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  cell            text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'paid', 'conflict', 'failed')),
  -- 'conflict': paid, but someone else got the plot first. Refund it from the Dodo dashboard.
  title           text not null,
  description     text not null default '',
  url             text not null default '',
  domain          text not null default '',
  logo_type       text not null,
  logo_url        text not null,
  logo_status     text not null default 'approved',  -- claim status once paid
  amount          integer not null,                  -- expected price in cents (USD)
  edit_token_hash text not null,
  ip_hash         text not null,
  device_id       text not null default '',
  checkout_session_id text,
  payment_id      text,
  created_at      timestamptz not null default now(),
  -- A pending order holds its plot until then, so two people can't pay for the same one.
  expires_at      timestamptz not null default now() + interval '30 minutes',
  paid_at         timestamptz
);

create index if not exists orders_cell_pending on public.orders (cell, expires_at) where status = 'pending';
create unique index if not exists orders_payment on public.orders (payment_id) where payment_id is not null;

alter table public.orders enable row level security;

create policy "admin can read orders" on public.orders
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'shivampratap54451@gmail.com');

revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated; -- still limited to the admin by RLS
