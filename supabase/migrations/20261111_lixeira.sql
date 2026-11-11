-- LIXEIRA: nada que a clínica exclui some de vez.
--
-- Por quê: em 11/11/2026 a Dra. Anna Carolina relatou orçamentos e fichas "sumidos" de dois pacientes
-- e não havia como saber se tinham sido excluídos, por quem ou quando (o banco não guardava exclusões e o
-- backup diário não pega o que é criado e apagado no mesmo dia).
--
-- Como funciona:
--   • Um gatilho BEFORE DELETE copia a linha inteira para public.lixeira antes de ela sair da tabela,
--     com quem excluiu (auth.uid() + nome do usuário) e quando. Vale para exclusão pela tela, pelas funções
--     do banco (excluir_orcamento_cascata etc.) e para as exclusões em cascata de um paciente.
--   • Tabelas cobertas: pacientes, documentos (fichas, orçamentos, anamneses, termos...), planos_tratamento,
--     plano_itens, financeiro e pacotes_sessoes.
--   • Dados de exemplo (pacientes/lançamentos com exemplo = true) não vão para a lixeira.
--   • O gatilho NUNCA impede uma exclusão: se a cópia falhar, a exclusão segue e fica só um aviso no log.
--   • lixeira_restaurar(ids) devolve as linhas às tabelas de origem (paciente primeiro, depois plano,
--     itens, pacotes, documentos e financeiro). Exige a permissão de seção 'lixeira' (admin sempre tem).
--   • lixeira_apagar(ids) apaga de vez — só administrador da clínica.
--   • Não há limpeza automática (REGRAS.md → automação nasce desligada). A tela oferece ao admin o botão
--     de apagar o que tem mais de 90 dias.
--
-- Limites conhecidos (documentados em ajuda.html):
--   • Restaurar um orçamento NÃO volta a descontar o estoque que foi estornado na exclusão.
--   • Arquivos do Storage (fotos) não passam pela lixeira; só as linhas do banco.

create table if not exists public.lixeira (
  id                 uuid primary key default gen_random_uuid(),
  clinica_id         uuid not null default public.current_clinica_id() references public.clinicas(id) on delete cascade,
  tabela             text not null check (tabela in ('pacientes','documentos','planos_tratamento','plano_itens','financeiro','pacotes_sessoes')),
  registro_id        text not null,
  paciente_id        uuid,
  paciente_nome      text,
  dados              jsonb not null,
  lote               bigint not null default txid_current(),
  excluido_em        timestamptz not null default now(),
  excluido_por       uuid,
  excluido_por_nome  text,
  restaurado_em      timestamptz,
  restaurado_por     uuid
);

create index if not exists lixeira_clinica_excluido_idx on public.lixeira (clinica_id, excluido_em desc);
create index if not exists lixeira_paciente_idx on public.lixeira (paciente_id);

alter table public.lixeira enable row level security;

-- Só leitura pela tela, e só para quem tem a seção "lixeira". Escrita apenas pelo gatilho e pelas funções abaixo.
drop policy if exists lixeira_ler on public.lixeira;
create policy lixeira_ler on public.lixeira
  for select to authenticated
  using (clinica_id = public.current_clinica_id() and public.tem_permissao_secao('lixeira'));

revoke all on public.lixeira from anon, authenticated;
grant select on public.lixeira to authenticated;

-- ─── Gatilho: guarda a linha antes de excluir ───
create or replace function public.lixeira_guardar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linha jsonb := to_jsonb(old);
  v_pac   uuid;
  v_nome_pac text;
  v_nome_usr text;
  v_exemplo text := coalesce(current_setting('lixeira.exemplo', true), '');
begin
  if tg_table_name = 'pacientes' then
    v_pac := old.id;
    v_nome_pac := v_linha->>'nome';
    if coalesce((v_linha->>'exemplo')::boolean, false) then
      -- Marca o paciente de exemplo nesta transação para as exclusões em cascata (documentos etc.) também pularem.
      perform set_config('lixeira.exemplo', v_exemplo || ',' || old.id::text, true);
      return old;
    end if;
  else
    v_pac := nullif(v_linha->>'paciente_id', '')::uuid;
    if coalesce((v_linha->>'exemplo')::boolean, false) then return old; end if;
    if v_pac is not null and position(v_pac::text in v_exemplo) > 0 then return old; end if;
    select p.nome into v_nome_pac from public.pacientes p where p.id = v_pac;
    if v_nome_pac is null and v_pac is not null then
      -- Exclusão em cascata: o paciente já saiu da tabela, mas acabou de entrar na lixeira.
      select l.paciente_nome into v_nome_pac from public.lixeira l
      where l.tabela = 'pacientes' and l.paciente_id = v_pac order by l.excluido_em desc limit 1;
    end if;
  end if;

  begin
    select u.nome into v_nome_usr from public.usuarios u where u.id = auth.uid();
    insert into public.lixeira (clinica_id, tabela, registro_id, paciente_id, paciente_nome, dados,
                                excluido_por, excluido_por_nome)
    values (coalesce(nullif(v_linha->>'clinica_id', '')::uuid, public.current_clinica_id()),
            tg_table_name, v_linha->>'id', v_pac, v_nome_pac, v_linha,
            auth.uid(), coalesce(v_nome_usr, case when auth.uid() is null then 'Sistema' end));
  exception when others then
    raise warning '[lixeira] não guardou %.%: %', tg_table_name, v_linha->>'id', sqlerrm;
  end;
  return old;
end;
$$;

revoke all on function public.lixeira_guardar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['pacientes','documentos','planos_tratamento','plano_itens','financeiro','pacotes_sessoes'] loop
    execute format('drop trigger if exists trg_lixeira on public.%I', t);
    execute format('create trigger trg_lixeira before delete on public.%I for each row execute function public.lixeira_guardar()', t);
  end loop;
end $$;

-- ─── Restaurar ───
create or replace function public.lixeira_restaurar(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cid uuid := public.current_clinica_id();
  r record;
  v_dados jsonb;
  v_existe boolean;
  v_ok int := 0;
  v_ja int := 0;
  v_erros jsonb := '[]'::jsonb;
begin
  if v_cid is null or not public.tem_permissao_secao('lixeira') then
    raise exception 'Sem permissão para restaurar itens da lixeira';
  end if;

  for r in
    select * from public.lixeira l
    where l.id = any(p_ids) and l.clinica_id = v_cid and l.restaurado_em is null
    order by array_position(array['pacientes','planos_tratamento','plano_itens','pacotes_sessoes','documentos','financeiro'], l.tabela),
             l.excluido_em
  loop
    -- Sempre devolve para a clínica dona da lixeira, nunca para outra.
    v_dados := r.dados || jsonb_build_object('clinica_id', v_cid);
    execute format('select exists(select 1 from public.%I where id::text = $1)', r.tabela) into v_existe using r.registro_id;
    if v_existe then
      v_ja := v_ja + 1;
    else
      begin
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', r.tabela, r.tabela)
          using v_dados;
        v_ok := v_ok + 1;
      exception when foreign_key_violation then
        v_erros := v_erros || jsonb_build_object('id', r.id, 'tabela', r.tabela,
          'motivo', 'Depende de um registro que não existe mais (restaure o paciente ou o orçamento junto).');
        continue;
      when others then
        v_erros := v_erros || jsonb_build_object('id', r.id, 'tabela', r.tabela, 'motivo', sqlerrm);
        continue;
      end;
    end if;
    update public.lixeira set restaurado_em = now(), restaurado_por = auth.uid() where id = r.id;
  end loop;

  return jsonb_build_object('ok', jsonb_array_length(v_erros) = 0, 'restaurados', v_ok, 'ja_existiam', v_ja, 'erros', v_erros);
end;
$$;

-- ─── Apagar de vez (só admin) ───
create or replace function public.lixeira_apagar(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cid uuid := public.current_clinica_id();
  v_n int;
begin
  if v_cid is null or not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.eh_admin) then
    raise exception 'Só o administrador da clínica pode apagar itens da lixeira de vez';
  end if;
  delete from public.lixeira where id = any(p_ids) and clinica_id = v_cid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'apagados', v_n);
end;
$$;

revoke all on function public.lixeira_restaurar(uuid[]) from public, anon;
revoke all on function public.lixeira_apagar(uuid[]) from public, anon;
grant execute on function public.lixeira_restaurar(uuid[]) to authenticated;
grant execute on function public.lixeira_apagar(uuid[]) to authenticated;
