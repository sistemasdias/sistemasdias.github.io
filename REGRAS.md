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
- **Subdomínio por clínica**: o mesmo Caddy do VPS acima também faz proxy de
  `<slug>.sistemasdias.com.br` pro GitHub Pages (ver `ROADMAP.md` →
  "Subdomínio por clínica"). O site principal fica acoplado à
  disponibilidade desse VPS quando acessado por subdomínio — se ele cair,
  os subdomínios caem junto (o link `?c=slug` no domínio do GitHub Pages
  continua no ar, pois não passa pelo VPS).

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

## Como uma atualização chega nas clínicas

- O site tem um service worker (`sw.js`) pro modo "app instalável"/offline.
  Os arquivos do app são servidos **network-first**: com internet, o
  navegador sempre baixa a versão publicada; o cache só entra se estiver
  offline. Um `git push` chega em todos os aparelhos na próxima abertura,
  sem precisar mudar nada no `sw.js`.
- `CACHE_NAME` em `sw.js` só precisa ser trocado quando se quer forçar uma
  limpeza geral do cache antigo em todos os aparelhos (raro).
- Se alguém "não vê a atualização": fechar todas as abas do sistema e abrir
  de novo com internet. Se persistir, no navegador: apagar dados do site.

## Automação

Nenhuma automação nova (cron, disparo em massa) entra já ligada. Ela nasce
desligada e só é ativada quando pedido explicitamente.

Automações já ativas hoje (via `pg_cron`, ver `cron.job` no Supabase):

- `gerar-pagamentos-mensais` (todo dia 1, 06h): cria a linha `pendente` do
  mês em `pagamentos` pra cada assinatura ativa.
- `auto-bloquear-inadimplentes` (todo dia, 09h, só age no último dia do
  mês): bloqueia (`clinicas.status='bloqueada'`) quem não tem pagamento
  `pago` do mês corrente.
- `auto-bloquear-trials-vencidos` (todo dia, 09h): bloqueia clínica em
  `plano='trial'` que passou de 14 dias desde `criado_em` sem virar
  assinatura paga. O prazo (14 dias) também está hardcoded em
  `admin-assinaturas.html` (`TRIAL_DIAS`) — mudar um exige mudar o outro.

## Painel de assinaturas (admin-assinaturas.html)

Ferramenta separada do sistema da clínica — é o painel **seu** (dono do
produto) pra cobrar as clínicas que usam o sistema, não algo que as clínicas
veem. Login por Supabase Auth normal; RLS de `assinaturas`, `pagamentos` e
escrita em `clinicas` restrita a `auth.jwt()->>'email' = 'claudiogallegoadv@gmail.com'`
— só sua conta consegue ler ou escrever essas tabelas, mesmo com a chave
anônima exposta no HTML (é seguro por design, não por obscuridade).

"+ Novo cliente" chama a Edge Function `criar-cliente-completo`
(`verify_jwt:true` + checagem do e-mail do dono dentro da função) e faz o
onboarding inteiro numa tacada: assinatura, `clinicas`, login no Supabase
Auth com **PIN aleatório gerado no servidor** (nunca escolhido/digitado por
ninguém), `usuarios` (admin da clínica), `config_clinica` básica, e dispara
um backup imediato. O PIN aparece uma única vez na tela pra você repassar.

**Existe outra função parecida, `criar-clinica`** (mais antiga, com mais
campos de branding e protegida por uma senha fixa `ADMIN_SECRET` em vez da
sessão logada) — não dá pra chamar ela com segurança direto do HTML público
deste painel, porque o segredo ficaria exposto no código-fonte da página.
As duas convivem hoje com propósitos diferentes: `criar-clinica` pra
chamada direta/manual (Postman, script), `criar-cliente-completo` pro botão
do painel. Se um dia quiser consolidar as duas, avaliar com calma — não é
urgente.
