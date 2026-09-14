-- Integração WhatsApp via Evolution API (self-hosted).
-- Três tabelas: instâncias cadastradas por clínica, mensagens recebidas
-- (webhook da Evolution) e mensagens enviadas (via Edge Function).
-- RLS segue o mesmo padrão já usado no projeto: isolamento por
-- current_clinica_id() e escrita condicionada a tem_permissao_secao().

-- ── whatsapp_instancias ──────────────────────────────────────────────
create table public.whatsapp_instancias (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null default current_clinica_id() references public.clinicas(id),
  instancia_nome text not null unique,
  numero_conectado text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create index idx_whatsapp_instancias_clinica_id on public.whatsapp_instancias using btree (clinica_id);

alter table public.whatsapp_instancias enable row level security;

create policy whatsapp_instancias_select on public.whatsapp_instancias
  for select using (clinica_id = current_clinica_id());

create policy whatsapp_instancias_insert on public.whatsapp_instancias
  for insert with check (clinica_id = current_clinica_id() and tem_permissao_secao('configuracoes'));

create policy whatsapp_instancias_update on public.whatsapp_instancias
  for update using (clinica_id = current_clinica_id() and tem_permissao_secao('configuracoes'))
  with check (clinica_id = current_clinica_id() and tem_permissao_secao('configuracoes'));

create policy whatsapp_instancias_delete on public.whatsapp_instancias
  for delete using (clinica_id = current_clinica_id() and tem_permissao_secao('configuracoes'));

-- ── whatsapp_mensagens_recebidas ─────────────────────────────────────
-- Gravada só pelo webhook (service role) — sem policy de insert/update/delete
-- para anon/authenticated, então RLS bloqueia escrita para esses papéis.
create table public.whatsapp_mensagens_recebidas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id),
  instancia_nome text not null,
  message_id text not null unique,
  remote_jid text,
  texto text,
  from_me boolean not null default false,
  payload_bruto jsonb,
  criado_em timestamptz not null default now()
);

create index idx_whatsapp_mensagens_recebidas_clinica_id on public.whatsapp_mensagens_recebidas using btree (clinica_id);

alter table public.whatsapp_mensagens_recebidas enable row level security;

create policy whatsapp_mensagens_recebidas_select on public.whatsapp_mensagens_recebidas
  for select using (clinica_id = current_clinica_id());

-- ── whatsapp_mensagens_enviadas ──────────────────────────────────────
-- Gravada só pela Edge Function whatsapp-enviar (service role) — mesma
-- lógica: sem policy de insert/update/delete para anon/authenticated.
create table public.whatsapp_mensagens_enviadas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id),
  instancia_nome text,
  paciente_id uuid references public.pacientes(id),
  numero text not null,
  texto text,
  evolution_message_id text,
  status text not null default 'enviado' check (status in ('enviado', 'erro')),
  erro text,
  enviado_por uuid references public.usuarios(id),
  criado_em timestamptz not null default now()
);

create index idx_whatsapp_mensagens_enviadas_clinica_id on public.whatsapp_mensagens_enviadas using btree (clinica_id);
create index idx_whatsapp_mensagens_enviadas_paciente_id on public.whatsapp_mensagens_enviadas using btree (paciente_id);

alter table public.whatsapp_mensagens_enviadas enable row level security;

create policy whatsapp_mensagens_enviadas_select on public.whatsapp_mensagens_enviadas
  for select using (clinica_id = current_clinica_id());
