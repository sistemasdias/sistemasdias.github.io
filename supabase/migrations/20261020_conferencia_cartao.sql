-- Conferência de recebimentos no cartão (parte 2 da taxa da maquininha). Aplicada em 20/10/2026 via MCP.
-- Novos recebimentos de cartão entram com conferencia='pendente'; a função conferir_cartao confirma
-- ("bateu") ou registra quanto caiu de verdade e lança a diferença como ajuste (despesa/receita).
alter table public.financeiro
  add column if not exists conferencia text check (conferencia in ('pendente','conferido')),
  add column if not exists valor_conferido numeric(12,2),
  add column if not exists conferido_em timestamptz;

create index if not exists financeiro_conferencia_pendente_idx
  on public.financeiro (clinica_id) where conferencia = 'pendente';

-- financeiro_calcula_liquido(): ver 20261020_taxa_cartao_por_clinica.sql; esta versão acrescenta
--   if TG_OP = 'INSERT' and NEW.conferencia is null then NEW.conferencia := 'pendente'; end if;
-- dentro do ramo de cartão (aplicada no banco; mantenha as duas migrações em sincronia).

create or replace function public.conferir_cartao(p_id uuid, p_recebido numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.financeiro%rowtype; esperado numeric; recebido numeric; diff numeric;
begin
  if not public.tem_permissao_secao('financeiro') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into l from public.financeiro
   where id = p_id and clinica_id = public.current_clinica_id() for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado'); end if;
  if l.conferencia is distinct from 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_conferido');
  end if;
  esperado := coalesce(l.valor_liquido, l.valor);
  recebido := coalesce(p_recebido, esperado);
  if recebido < 0 then return jsonb_build_object('ok', false, 'motivo', 'valor_invalido'); end if;
  update public.financeiro
     set conferencia = 'conferido', valor_conferido = recebido, conferido_em = now()
   where id = l.id;
  diff := round(esperado - recebido, 2);
  if diff <> 0 then
    insert into public.financeiro
      (tipo, data, descricao, categoria, valor, forma_pagamento, status, obs, paciente_id, clinica_id, profissional_id)
    values
      (case when diff > 0 then 'despesa' else 'receita' end,
       (now() at time zone 'America/Sao_Paulo')::date,
       'Ajuste de cartão — ' || coalesce(l.descricao, ''),
       'Ajuste de cartão', abs(diff), null, 'recebido',
       'Conferência: esperado ' || esperado || ', caiu ' || recebido,
       l.paciente_id, l.clinica_id, l.profissional_id);
  end if;
  return jsonb_build_object('ok', true, 'esperado', esperado, 'recebido', recebido, 'diferenca', diff);
end $$;

revoke all on function public.conferir_cartao(uuid, numeric) from public, anon;
grant execute on function public.conferir_cartao(uuid, numeric) to authenticated;
