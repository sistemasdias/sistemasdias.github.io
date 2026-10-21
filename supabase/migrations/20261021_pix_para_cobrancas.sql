-- Chave Pix da clínica para as mensagens da aba Cobranças. Aplicada em 21/10/2026 via MCP.
-- Ficam só em config_clinica (visível a quem está logado na clínica); a visão pública
-- config_clinica_publica NÃO inclui estas colunas.
alter table public.config_clinica
  add column if not exists pix_chave text,
  add column if not exists pix_titular text;
