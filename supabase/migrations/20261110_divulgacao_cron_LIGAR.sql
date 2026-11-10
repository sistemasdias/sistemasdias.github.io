-- LIGA o envio automático das divulgações. NÃO aplicar junto com a migração principal:
-- pela regra do projeto (REGRAS.md → Automação), só roda quando for pedido explicitamente.
--
-- Depois disto, ainda falta ligar clínica por clínica:
--   update public.config_clinica set divulgacao_whatsapp = true where clinica_id = '<id da clínica>';
--
-- Para DESLIGAR tudo de uma vez:
--   select cron.unschedule('divulgacao-processar');

create extension if not exists pg_net;

-- Segredo aleatório gerado dentro do banco (ninguém vê nem digita o valor).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'divulgacao_cron_secret',
                           'Autoriza o pg_cron a chamar a Edge Function divulgacao-processar')
where not exists (select 1 from vault.secrets where name = 'divulgacao_cron_secret');

-- A cada minuto. A função envia no máximo UMA mensagem por clínica por chamada e respeita
-- intervalo, limite diário e horário de cada divulgação — chamar mais vezes não acelera nada.
select cron.schedule('divulgacao-processar', '* * * * *', $cron$
  select net.http_post(
    url := 'https://nathaeuqbeqlvkftbmes.supabase.co/functions/v1/divulgacao-processar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'divulgacao_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$cron$);
