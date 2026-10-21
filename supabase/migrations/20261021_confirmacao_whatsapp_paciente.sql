-- Confirmação de consulta pela própria paciente no WhatsApp (nasce DESLIGADA). Aplicada em 21/10/2026 via MCP.
-- Edge Function whatsapp-webhook v11 (resposta.mjs + processarRespostaPaciente).
--   off       = ignora respostas das pacientes (padrão)
--   registrar = marca a consulta (confirmou / pediu remarcar) sem mandar mensagem
--   responder = marca e agradece à paciente
alter table public.config_clinica
  add column if not exists whatsapp_confirmacao text not null default 'off'
  check (whatsapp_confirmacao in ('off', 'registrar', 'responder'));

alter table public.agenda
  add column if not exists paciente_resposta text check (paciente_resposta in ('confirmou', 'remarcar')),
  add column if not exists paciente_respondeu_em timestamptz;
