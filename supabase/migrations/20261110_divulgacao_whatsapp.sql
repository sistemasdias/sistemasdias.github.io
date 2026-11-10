-- Divulgação pelo WhatsApp (vídeo, imagem, texto e links) com fila e limites — nasce DESLIGADA.
--
-- A clínica monta a divulgação (mensagem + anexo opcional), escolhe as pacientes e o sistema vai
-- enviando sozinho, uma por vez, respeitando intervalo entre mensagens, limite por dia e horário.
-- Quem envia é a Edge Function `divulgacao-processar`, chamada a cada minuto pelo pg_cron
-- (o agendamento fica em 20261110_divulgacao_cron_LIGAR.sql e só é aplicado quando pedido).
--
-- Três travas, todas desligadas por padrão:
--   1. config_clinica.divulgacao_whatsapp = false  → a clínica não envia nada
--   2. sem o segredo `divulgacao_cron_secret` no Vault → a função recusa qualquer chamada
--   3. sem o job do pg_cron → ninguém chama a função

-- ── Chave por clínica (desligada) ────────────────────────────────────
alter table public.config_clinica
  add column if not exists divulgacao_whatsapp boolean not null default false;

-- ── Paciente que não quer receber divulgação (LGPD: direito de oposição) ──
alter table public.pacientes
  add column if not exists sem_divulgacao boolean not null default false,
  add column if not exists sem_divulgacao_em timestamptz;

-- ── divulgacoes ──────────────────────────────────────────────────────
-- Os limites têm teto no próprio banco: a tela não consegue pedir um ritmo arriscado.
create table public.divulgacoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null default current_clinica_id() references public.clinicas(id),
  titulo text not null,
  mensagem text not null default '',
  midia_caminho text,                       -- caminho no bucket divulgacao-midia (<clinica_id>/arquivo)
  midia_tipo text check (midia_tipo in ('video', 'image')),
  midia_mime text,
  midia_nome text,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'enviando', 'pausada', 'concluida', 'cancelada')),
  motivo_pausa text,
  intervalo_min_seg integer not null default 60 check (intervalo_min_seg >= 45),
  intervalo_max_seg integer not null default 150 check (intervalo_max_seg <= 900),
  limite_dia integer not null default 40 check (limite_dia between 1 and 80),
  hora_inicio integer not null default 9 check (hora_inicio >= 7),
  hora_fim integer not null default 19 check (hora_fim <= 21),
  proximo_envio_em timestamptz not null default now(),
  erros_seguidos integer not null default 0,
  criado_por uuid references public.usuarios(id),
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  check (intervalo_max_seg >= intervalo_min_seg),
  check (hora_fim > hora_inicio),
  check (mensagem <> '' or midia_caminho is not null)
);

create index idx_divulgacoes_clinica_id on public.divulgacoes using btree (clinica_id);
create index idx_divulgacoes_fila on public.divulgacoes using btree (proximo_envio_em) where status = 'enviando';

alter table public.divulgacoes enable row level security;

create policy divulgacoes_select on public.divulgacoes
  for select using (clinica_id = current_clinica_id());

create policy divulgacoes_insert on public.divulgacoes
  for insert with check (clinica_id = current_clinica_id() and tem_permissao_secao('divulgacao'));

create policy divulgacoes_update on public.divulgacoes
  for update using (clinica_id = current_clinica_id() and tem_permissao_secao('divulgacao'))
  with check (clinica_id = current_clinica_id() and tem_permissao_secao('divulgacao'));

create policy divulgacoes_delete on public.divulgacoes
  for delete using (clinica_id = current_clinica_id() and tem_permissao_secao('divulgacao')
    and status in ('rascunho', 'cancelada', 'concluida'));

-- ── divulgacao_envios (a fila: uma linha por paciente) ───────────────
-- A clínica só INSERE (ao montar a lista). Quem muda o status é a Edge Function (service role):
-- sem policy de update/delete para anon/authenticated, a RLS bloqueia.
create table public.divulgacao_envios (
  id uuid primary key default gen_random_uuid(),
  divulgacao_id uuid not null references public.divulgacoes(id) on delete cascade,
  clinica_id uuid not null default current_clinica_id() references public.clinicas(id),
  paciente_id uuid references public.pacientes(id) on delete set null,
  nome text,
  chamada text,                             -- como chamar a paciente na mensagem ({nome})
  numero text not null,                     -- só dígitos, com DDI 55
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'erro', 'pulado')),
  erro text,
  evolution_message_id text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (divulgacao_id, numero)            -- o mesmo número nunca recebe duas vezes a mesma divulgação
);

create index idx_divulgacao_envios_fila on public.divulgacao_envios using btree (divulgacao_id, status, criado_em);
create index idx_divulgacao_envios_clinica_dia on public.divulgacao_envios using btree (clinica_id, enviado_em) where status = 'enviado';
create index idx_divulgacao_envios_paciente_id on public.divulgacao_envios using btree (paciente_id);

alter table public.divulgacao_envios enable row level security;

create policy divulgacao_envios_select on public.divulgacao_envios
  for select using (clinica_id = current_clinica_id());

create policy divulgacao_envios_insert on public.divulgacao_envios
  for insert with check (
    clinica_id = current_clinica_id()
    and tem_permissao_secao('divulgacao')
    and status = 'pendente'
    and exists (select 1 from public.divulgacoes d
                where d.id = divulgacao_id and d.clinica_id = current_clinica_id())
  );

-- ── Anexos (vídeo/imagem) ────────────────────────────────────────────
-- Bucket privado: a Edge Function gera um link temporário na hora de enviar.
-- 16 MB é o limite do próprio WhatsApp para vídeo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('divulgacao-midia', 'divulgacao-midia', false, 16777216, array['video/mp4', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy divulgacao_midia_select on storage.objects
  for select using (bucket_id = 'divulgacao-midia'
    and (storage.foldername(name))[1] = (current_clinica_id())::text);

create policy divulgacao_midia_insert on storage.objects
  for insert with check (bucket_id = 'divulgacao-midia'
    and (storage.foldername(name))[1] = (current_clinica_id())::text
    and tem_permissao_secao('divulgacao'));

create policy divulgacao_midia_delete on storage.objects
  for delete using (bucket_id = 'divulgacao-midia'
    and (storage.foldername(name))[1] = (current_clinica_id())::text
    and tem_permissao_secao('divulgacao'));

-- ── Segredo do agendador ─────────────────────────────────────────────
-- A função `divulgacao-processar` não usa JWT (quem chama é o pg_cron). Ela só trabalha se o
-- header x-cron-secret bater com o segredo guardado no Vault. O valor nunca sai do banco:
-- nem o código, nem a conversa, nem o painel precisam conhecê-lo. Sem segredo criado → sempre false.
create or replace function public.divulgacao_cron_confere(p_segredo text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(length(p_segredo) >= 32 and exists (
    select 1 from vault.decrypted_secrets
    where name = 'divulgacao_cron_secret' and decrypted_secret = p_segredo
  ), false);
$$;

revoke all on function public.divulgacao_cron_confere(text) from public, anon, authenticated;
grant execute on function public.divulgacao_cron_confere(text) to service_role;

-- ── Resumo para a tela (quantas enviadas / na fila / com erro) ───────
-- security_invoker: a view obedece à RLS de quem consulta (cada clínica só vê o seu).
create view public.divulgacao_resumo with (security_invoker = true) as
select
  divulgacao_id,
  clinica_id,
  count(*)::int as total,
  (count(*) filter (where status = 'enviado'))::int as enviados,
  (count(*) filter (where status = 'pendente'))::int as pendentes,
  (count(*) filter (where status = 'erro'))::int as erros,
  (count(*) filter (where status = 'pulado'))::int as pulados,
  max(enviado_em) as ultimo_envio_em
from public.divulgacao_envios
group by divulgacao_id, clinica_id;
