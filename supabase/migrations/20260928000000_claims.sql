-- Claim Mars: plots, public map view, logo storage and admin moderation.
--
-- Visitors never touch the claims table directly. They read the claims_public view,
-- and every write goes through the `claim` edge function, which validates input,
-- enforces free-claim limits and hashes edit tokens and IP addresses.

create table if not exists public.claims (
  cell            text primary key,                 -- H3 cell id of the plot
  title           text not null check (char_length(title) between 1 and 40),
  description     text not null default '' check (char_length(description) <= 100),
  url             text not null default '',
  domain          text not null default '',
  logo_type       text not null check (logo_type in ('logodev', 'monogram', 'upload')),
  logo_url        text not null,
  free            boolean not null default true,
  status          text not null default 'pending' check (status in ('pending', 'approved')),
  created_at      timestamptz not null default now(),
  lands_at        timestamptz,                      -- when the signal "reaches Mars"
  edit_token_hash text not null,                    -- sha256 of the owner's edit token
  ip_hash         text not null,                    -- salted hash, only for rate limiting
  device_id       text not null default ''
);

create index if not exists claims_ip_recent on public.claims (ip_hash, created_at);
create index if not exists claims_device on public.claims (device_id);
create index if not exists claims_status on public.claims (status, created_at);

alter table public.claims enable row level security;

-- The site owner (admin) can see and moderate everything. Rejecting a claim deletes it,
-- which frees the plot again. Change the email here to move admin rights.
create policy "admin can read claims" on public.claims
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'shivampratap54451@gmail.com');

create policy "admin can approve claims" on public.claims
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'shivampratap54451@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'shivampratap54451@gmail.com');

create policy "admin can reject claims" on public.claims
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'shivampratap54451@gmail.com');

-- What the map shows. Plots awaiting review appear as claimed, without their logo or text.
-- The view runs with its owner's rights (intentionally not security_invoker), so it can
-- read the table while never exposing edit_token_hash, ip_hash or device_id.
create or replace view public.claims_public as
select
  cell,
  status,
  free,
  created_at,
  lands_at,
  case when status = 'approved' then title end        as title,
  case when status = 'approved' then description end  as description,
  case when status = 'approved' then url end          as url,
  case when status = 'approved' then domain end       as domain,
  case when status = 'approved' then logo_type end    as logo_type,
  case when status = 'approved' then logo_url end     as logo_url
from public.claims;

-- Supabase grants every role full rights on new tables and views by default. Some view
-- columns map straight onto table columns, which makes the view auto-updatable in
-- Postgres, and it runs with its owner's rights, so without these revokes anyone could
-- UPDATE or DELETE claims through it. Visitors may only read the view.
revoke all on public.claims from anon, authenticated;
grant select, update, delete on public.claims to authenticated; -- still limited to the admin by RLS
revoke all on public.claims_public from anon, authenticated;
grant select on public.claims_public to anon, authenticated;

-- Uploaded logos (public read; only the edge function writes, with the secret key).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 524288, array['image/png'])
on conflict (id) do nothing;
