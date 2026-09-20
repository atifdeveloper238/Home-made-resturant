-- ============================================================
-- ADDITIVE MIGRATION — run this ONCE in Supabase SQL Editor.
-- Does NOT touch any existing table/column/policy from your
-- original supabase-schema.sql. Only adds new things needed for:
--   - size variants (Standard/Small/Large)
--   - riders roster (admin-managed list)
--   - the chat realtime fix (safe/idempotent publication check)
-- ============================================================

-- 1. VARIANTS ---------------------------------------------------
alter table menu_items add column if not exists has_variants boolean not null default false;

create table if not exists menu_item_variants (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  variant_name text not null,        -- e.g. 'Standard', 'Small', 'Large'
  price numeric(10,2) not null,
  description text,                  -- one-line description shown to customer
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_variants_menu_item on menu_item_variants(menu_item_id);

alter table menu_item_variants enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='menu_item_variants' and policyname='public read variants') then
    create policy "public read variants" on menu_item_variants for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='menu_item_variants' and policyname='admin write variants') then
    create policy "admin write variants" on menu_item_variants for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- 2. RIDERS ROSTER ------------------------------------------------
create table if not exists riders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table riders enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='riders' and policyname='admin all riders') then
    create policy "admin all riders" on riders for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- 3. CHAT REALTIME FIX ---------------------------------------------
-- Your customer<->admin chat bug was actually in the client JS
-- (fixed in the new customer.js), but this makes sure the table
-- itself is broadcasting changes — safe to run even if it's
-- already added via the Supabase dashboard.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;
