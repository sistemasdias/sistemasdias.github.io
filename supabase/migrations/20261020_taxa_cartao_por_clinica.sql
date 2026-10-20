-- Taxa da maquininha por clínica (config_clinica.taxas_cartao) e valor líquido por lançamento.
-- Aplicada em produção em 20/10/2026 via MCP. O cálculo roda num trigger para cobrir
-- todos os caminhos de lançamento (Financeiro, ficha da paciente, Orçamento, RPCs).
alter table public.config_clinica add column if not exists taxas_cartao jsonb;
alter table public.financeiro
  add column if not exists taxa_cartao_pct numeric(6,3),
  add column if not exists valor_liquido numeric(12,2);

create or replace function public.financeiro_calcula_liquido()
returns trigger language plpgsql security definer set search_path = public as $$
declare t jsonb; txt text; pct numeric;
begin
  if NEW.tipo = 'receita' and NEW.forma_pagamento is not null
     and (NEW.forma_pagamento = 'debito' or NEW.forma_pagamento like 'credito-%') then
    if TG_OP = 'UPDATE'
       and NEW.valor is not distinct from OLD.valor
       and NEW.forma_pagamento is not distinct from OLD.forma_pagamento
       and NEW.tipo is not distinct from OLD.tipo then
      return NEW;  -- não recalcula lançamento antigo se nada relevante mudou
    end if;
    select c.taxas_cartao into t from public.config_clinica c where c.clinica_id = NEW.clinica_id limit 1;
    txt := t ->> NEW.forma_pagamento;
    if txt is not null and txt ~ '^[0-9]+([.][0-9]+)?$' then
      pct := txt::numeric;
      NEW.taxa_cartao_pct := pct;
      NEW.valor_liquido := round(NEW.valor * (1 - pct / 100), 2);
    else
      NEW.taxa_cartao_pct := null;
      NEW.valor_liquido := null;
    end if;
  else
    NEW.taxa_cartao_pct := null;
    NEW.valor_liquido := null;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_financeiro_liquido on public.financeiro;
create trigger trg_financeiro_liquido
  before insert or update on public.financeiro
  for each row execute function public.financeiro_calcula_liquido();
