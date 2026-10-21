-- Pacotes de sessões. Aplicada em 21/10/2026 via MCP.
-- A paciente compra N sessões de um procedimento; cada consulta ligada ao pacote (agenda.pacote_id) que
-- vira "realizado" desconta uma sessão, por trigger (cobre qualquer caminho: botão, "Fechar dia",
-- fechamento guiado, WhatsApp). Desfazer o "realizado" ou apagar a consulta devolve a sessão.
create table if not exists public.pacotes_sessoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null default public.current_clinica_id() references public.clinicas(id),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  procedimento text not null,
  total_sessoes integer not null check (total_sessoes between 1 and 100),
  sessoes_realizadas integer not null default 0 check (sessoes_realizadas >= 0),
  valor_total numeric(12,2),
  validade date,
  status text not null default 'ativo' check (status in ('ativo', 'concluido', 'cancelado')),
  obs text,
  criado_em timestamptz not null default now()
);
create index if not exists pacotes_sessoes_paciente_idx on public.pacotes_sessoes (paciente_id, status);
create index if not exists pacotes_sessoes_clinica_idx on public.pacotes_sessoes (clinica_id, status);

alter table public.pacotes_sessoes enable row level security;
drop policy if exists isolado_por_clinica on public.pacotes_sessoes;
create policy isolado_por_clinica on public.pacotes_sessoes for all to authenticated
  using (clinica_id = public.current_clinica_id())
  with check (clinica_id = public.current_clinica_id());

alter table public.agenda
  add column if not exists pacote_id uuid references public.pacotes_sessoes(id) on delete set null,
  add column if not exists sessao_contada boolean not null default false;

create or replace function public.agenda_sessao_pacote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 1) estorno: já estava contada e agora saiu de "realizado" ou trocou de pacote
  if TG_OP = 'UPDATE' and OLD.sessao_contada
     and (NEW.status <> 'realizado' or NEW.pacote_id is distinct from OLD.pacote_id) then
    update public.pacotes_sessoes
       set sessoes_realizadas = greatest(sessoes_realizadas - 1, 0),
           status = case when status = 'concluido' and greatest(sessoes_realizadas - 1, 0) < total_sessoes then 'ativo' else status end
     where id = OLD.pacote_id and clinica_id = OLD.clinica_id;
    NEW.sessao_contada := false;
  end if;
  -- 2) contagem: está "realizado", tem pacote e ainda não foi contada
  if NEW.pacote_id is not null and NEW.status = 'realizado' and not NEW.sessao_contada then
    update public.pacotes_sessoes
       set sessoes_realizadas = sessoes_realizadas + 1,
           status = case when status = 'ativo' and sessoes_realizadas + 1 >= total_sessoes then 'concluido' else status end
     where id = NEW.pacote_id and clinica_id = NEW.clinica_id;
    NEW.sessao_contada := true;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_agenda_sessao_pacote on public.agenda;
create trigger trg_agenda_sessao_pacote
  before insert or update of status, pacote_id on public.agenda
  for each row execute function public.agenda_sessao_pacote();

create or replace function public.agenda_sessao_pacote_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.sessao_contada and OLD.pacote_id is not null then
    update public.pacotes_sessoes
       set sessoes_realizadas = greatest(sessoes_realizadas - 1, 0),
           status = case when status = 'concluido' and greatest(sessoes_realizadas - 1, 0) < total_sessoes then 'ativo' else status end
     where id = OLD.pacote_id and clinica_id = OLD.clinica_id;
  end if;
  return OLD;
end $$;

drop trigger if exists trg_agenda_sessao_pacote_delete on public.agenda;
create trigger trg_agenda_sessao_pacote_delete
  after delete on public.agenda
  for each row execute function public.agenda_sessao_pacote_delete();
