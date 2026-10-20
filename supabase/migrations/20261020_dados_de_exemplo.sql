-- Onboarding com dados de exemplo. Aplicada em 20/10/2026 via MCP (junto com a versão de
-- admin_saude_clinicas que ignora dados de exemplo — ver 20261020_admin_saude_clinicas.sql).
-- Clínica com menos de 3 pacientes reais pode criar 4 pacientes, 5 consultas e 5 lançamentos
-- marcados exemplo=true. Telefone vazio: nunca dispara WhatsApp. Remoção apaga tudo que é
-- exemplo e o que a pessoa criou em cima dos pacientes de exemplo.
alter table public.pacientes  add column if not exists exemplo boolean not null default false;
alter table public.agenda     add column if not exists exemplo boolean not null default false;
alter table public.financeiro add column if not exists exemplo boolean not null default false;

create or replace function public.criar_dados_exemplo()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; hoje date; p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  cid := public.current_clinica_id();
  if cid is null or not public.tem_permissao_secao('configuracoes') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if exists (select 1 from public.pacientes where clinica_id = cid and exemplo) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_existe');
  end if;
  if (select count(*) from public.pacientes where clinica_id = cid and not exemplo) >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'clinica_em_uso');
  end if;
  hoje := (now() at time zone 'America/Sao_Paulo')::date;

  insert into public.pacientes (clinica_id, exemplo, nome, telefone, tratamento, data_atendimento, data_retorno, prazo_meses, data_nascimento)
  values (cid, true, 'Maria Exemplo', '', 'Limpeza', hoje - 200, hoje - 20, 6, (hoje - interval '32 years')::date) returning id into p1;
  insert into public.pacientes (clinica_id, exemplo, nome, telefone, tratamento, data_atendimento, data_retorno, prazo_meses)
  values (cid, true, 'João Exemplo', '', 'Clareamento', hoje - 10, hoje + 20, 1) returning id into p2;
  insert into public.pacientes (clinica_id, exemplo, nome, telefone, tratamento, data_atendimento)
  values (cid, true, 'Ana Exemplo', '', 'Botox', hoje - 400) returning id into p3;
  insert into public.pacientes (clinica_id, exemplo, nome, telefone, tratamento)
  values (cid, true, 'Carlos Exemplo', '', 'Avaliação') returning id into p4;

  insert into public.agenda (clinica_id, exemplo, paciente_id, nome, telefone, procedimento, data, hora, status) values
    (cid, true, p1, 'Maria Exemplo',  '', 'Limpeza',     hoje,     '09:00', 'agendado'),
    (cid, true, p2, 'João Exemplo',   '', 'Clareamento', hoje,     '14:00', 'agendado'),
    (cid, true, p3, 'Ana Exemplo',    '', 'Botox',       hoje + 1, '10:00', 'agendado'),
    (cid, true, p4, 'Carlos Exemplo', '', 'Avaliação',   hoje - 1, '15:00', 'agendado'),
    (cid, true, p2, 'João Exemplo',   '', 'Clareamento', hoje - 7, '11:00', 'realizado');

  insert into public.financeiro (clinica_id, exemplo, paciente_id, tipo, data, descricao, categoria, valor, forma_pagamento, status) values
    (cid, true, p1,   'receita', hoje - 7, 'Limpeza — Maria Exemplo',      'Procedimentos', 350, 'pix',        'recebido'),
    (cid, true, p2,   'receita', hoje - 5, 'Clareamento — João Exemplo',   'Procedimentos', 600, 'pix',        'pendente'),
    (cid, true, p3,   'receita', hoje + 3, 'Botox — Ana Exemplo',          'Procedimentos', 200, 'pix',        'pendente'),
    (cid, true, p4,   'receita', hoje - 1, 'Avaliação — Carlos Exemplo',   'Procedimentos', 500, 'credito-1x', 'recebido'),
    (cid, true, null, 'despesa', hoje - 2, 'Material de consumo (exemplo)', 'Outros',        120, 'pix',        'recebido');

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remover_dados_exemplo()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; ids uuid[]; n_pac int;
begin
  cid := public.current_clinica_id();
  if cid is null or not public.tem_permissao_secao('configuracoes') then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.pacientes where clinica_id = cid and exemplo;
  delete from public.financeiro where clinica_id = cid and (exemplo or paciente_id = any(ids));
  delete from public.agenda     where clinica_id = cid and (exemplo or paciente_id = any(ids));
  update public.estoque_movimentos set paciente_id = null where paciente_id = any(ids);
  update public.whatsapp_mensagens_enviadas set paciente_id = null where paciente_id = any(ids);
  delete from public.pacientes where clinica_id = cid and exemplo;
  get diagnostics n_pac = row_count;
  return jsonb_build_object('ok', true, 'pacientes', n_pac);
end $$;

revoke all on function public.criar_dados_exemplo(), public.remover_dados_exemplo() from public, anon;
grant execute on function public.criar_dados_exemplo(), public.remover_dados_exemplo() to authenticated;
