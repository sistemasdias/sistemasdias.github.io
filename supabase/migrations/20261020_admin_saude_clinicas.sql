-- Painel de saúde por clínica (admin-assinaturas.html). Aplicada em 20/10/2026 via MCP.
-- Só o e-mail do dono do produto consegue chamar; devolve apenas agregados (nunca dados de pacientes).
create or replace function public.admin_saude_clinicas()
returns table (
  clinica_id uuid, slug text, usuarios_ativos int, ultimo_login timestamptz,
  pacientes_total int, pacientes_novos_30d int,
  consultas_30d int, realizadas_30d int, faltas_30d int,
  lancamentos_30d int, whatsapp_30d int, ultima_atividade timestamptz
) language plpgsql stable security definer set search_path = public, auth as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'claudiogallegoadv@gmail.com' then
    raise exception 'sem permissao';
  end if;
  return query
  select c.id, c.slug,
    (select count(*)::int from usuarios u where u.clinica_id = c.id and u.ativo),
    (select max(a.last_sign_in_at) from usuarios u join auth.users a on a.id = u.id where u.clinica_id = c.id),
    (select count(*)::int from pacientes p where p.clinica_id = c.id),
    (select count(*)::int from pacientes p where p.clinica_id = c.id and p.criado_em >= now() - interval '30 days'),
    (select count(*)::int from agenda g where g.clinica_id = c.id and g.data >= current_date - 30 and g.data <= current_date and g.status <> 'cancelado'),
    (select count(*)::int from agenda g where g.clinica_id = c.id and g.data >= current_date - 30 and g.data <= current_date and g.status = 'realizado'),
    (select count(*)::int from agenda g where g.clinica_id = c.id and g.data >= current_date - 30 and g.data <= current_date and g.status = 'faltou'),
    (select count(*)::int from financeiro f where f.clinica_id = c.id and f.criado_em >= now() - interval '30 days'),
    (select count(*)::int from whatsapp_mensagens_enviadas w where w.clinica_id = c.id and w.criado_em >= now() - interval '30 days'),
    greatest(
      (select max(g.criado_em) from agenda g where g.clinica_id = c.id),
      (select max(f.criado_em) from financeiro f where f.clinica_id = c.id),
      (select max(p.criado_em) from pacientes p where p.clinica_id = c.id)
    )
  from clinicas c;
end $$;

revoke all on function public.admin_saude_clinicas() from public, anon;
grant execute on function public.admin_saude_clinicas() to authenticated;
