# REGRAS.md

Regras de como este projeto é operado — se uma decisão importante não estiver
aqui, ela não existe (não confiar só no histórico de conversa).

## Onde fica cada coisa

- **Banco + backend**: Supabase, projeto `nathaeuqbeqlvkftbmes` (produção).
  Tabelas, RLS, Edge Functions — tudo lá.
- **Código do site**: este repositório (`sistemasdias-repo`).
- **Hospedagem do site**: **GitHub Pages** (remote `sistemasdias.github.io`).
  Não usa Vercel. Cada `git push` na `main` publica sozinho.
- **Servidor da Evolution API (WhatsApp)**: VPS próprio na Hetzner, fora do
  Supabase e fora deste repo. Ver `whatsapp-evolution/` para detalhes.

## RLS — padrão usado em toda tabela nova

Toda tabela nova de clínica segue o mesmo padrão:

- `clinica_id uuid not null default current_clinica_id() references clinicas(id)`
- Isolamento por clínica: `clinica_id = current_clinica_id()` em toda policy
- Escrita condicionada quando a seção tem permissão dedicada:
  `tem_permissao_secao('nome_da_secao')`
- Tabelas gravadas só por Edge Function (service role) não recebem policy de
  insert/update/delete para `anon`/`authenticated` — a ausência da policy já
  bloqueia, já que o Supabase concede grant de tabela por padrão e a RLS é a
  única barreira real.

Funções de apoio já existentes no banco: `current_clinica_id()` e
`tem_permissao_secao(secao text)`.

## Secrets

- Nunca em código, nunca em commit, nunca colados na conversa com a IA.
- Ficam só em **Supabase → Edge Functions → Secrets**.
- Quem precisa ver o valor pra colar em algum outro painel (Evolution API,
  etc.) é o humano — a IA não digita segredo em formulário de terceiros.

## Multi-clínica (WhatsApp)

Este sistema é multi-tenant. Uma única Evolution API (um VPS, vários
"instances") atende todas as clínicas. Ver `ROADMAP.md` para o passo a passo
de onboarding de clínica nova.

## Automação

Nenhuma automação nova (cron, disparo em massa) entra já ligada. Ela nasce
desligada e só é ativada quando pedido explicitamente.
