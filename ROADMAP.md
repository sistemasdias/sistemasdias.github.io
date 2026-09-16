# ROADMAP.md

## Integração WhatsApp via Evolution API (self-hosted)

### Feito

- [x] Migração `whatsapp-evolution/migrations/001_whatsapp.sql` aplicada em
      produção — tabelas `whatsapp_instancias`, `whatsapp_mensagens_recebidas`,
      `whatsapp_mensagens_enviadas`, com RLS.
- [x] Edge Function `whatsapp-webhook` deployada (`verify_jwt: false`,
      protegida por `EVOLUTION_WEBHOOK_SECRET`).
- [x] Edge Function `whatsapp-enviar` deployada (`verify_jwt: true`, chamada
      pelo frontend autenticado).
- [x] Botão "📲 Enviar lembretes de hoje via WhatsApp" no painel de retornos
      do [index.html](index.html).
- [x] Formulário de cadastro de instância em
      [configuracoes.html](configuracoes.html) (só `instancia_nome` +
      `numero_conectado` — a apikey da Evolution nunca é pedida ali).
- [x] Domínio `sistemasdias.com.br` registrado (registro.br).
- [x] VPS Hetzner (CPX22, Helsinki) rodando Docker Compose: Evolution API +
      Postgres + Redis + Caddy (HTTPS automático via Let's Encrypt).
- [x] Subdomínio `evolution.sistemasdias.com.br` → IP do VPS, certificado
      válido emitido.
- [x] Secrets configurados no Supabase: `EVOLUTION_API_URL`,
      `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`.
- [x] Instância `clinica-anna` criada na Evolution API, webhook configurado
      e testado ponta a ponta (mensagem de teste gravada e removida).
- [x] Linha da instância `clinica-anna` cadastrada em `whatsapp_instancias`,
      vinculada à Clínica Dra. Anna Carolina Dias.

- [x] WhatsApp da clínica (+55 17 98211-3940) conectado à instância
      `clinica-anna` em 15/09/2026 — estado `open`.

### Como conectar (ou reconectar) o WhatsApp de uma instância

O QR/código gerado pela API gira a cada ~45s, então mandar por chat não
funciona (chega vencido). Use o Manager, que renova o QR sozinho na tela:

1. Abrir `https://evolution.sistemasdias.com.br/manager` num computador e
   entrar com a `EVOLUTION_API_KEY` (está nos Secrets do Supabase).
2. Clicar na instância → aparece o QR ao vivo.
3. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho →
   apontar pro QR. Nome do dispositivo: qualquer (ex. "Sistema Clínica").
4. Conferir: `GET /instance/connectionState/<nome>` deve responder `open`.

Se a sessão cair (celular muito tempo offline, logout), repetir o processo.

### Instância própria do dono (sistemasdias-admin)

Separada das instâncias de cada clínica (que são pra elas falarem com os
próprios pacientes). Essa é o WhatsApp do dono do sistema, usada só pela
Edge Function `criar-cliente-completo` pra mandar a mensagem de boas-vindas
(link, e-mail, PIN) automaticamente pra clínica nova, sem precisar clicar.

- [x] Instância `sistemasdias-admin` criada na Evolution API (16/09/2026).
- [ ] Conectar o WhatsApp do dono a essa instância (mesmo processo de
      "Como conectar" acima, trocando `<nome>` por `sistemasdias-admin`).

Se não estiver conectada, o envio automático simplesmente falha em
silêncio e o painel [admin-assinaturas.html](admin-assinaturas.html) cai no
botão manual — não trava o cadastro do cliente.

### Falta

- [x] Teste real de envio pelo sistema — confirmado funcionando (botão de
      lembretes, confirmação de consulta na agenda do dia, e os comandos
      `agendar:`/`agenda:`/`confirmar agenda:` pelo próprio WhatsApp).
- [ ] Confirmar no celular da clínica que os dois últimos ajustes (login
      lembrando a clínica quando a sessão expira, e o cabeçalho/barra da
      Agenda não vazarem mais da tela) realmente resolveram na prática.

### Onboarding de uma clínica nova (ex.: Dra. Anna Munique)

Não precisa mudar código nem schema — o desenho já é multi-tenant. Passos:

1. Criar a instância na Evolution API (mesmo servidor, outro nome):
   `POST /instance/create` com `instanceName` novo, ex.
   `clinica-anna-munique`.
2. Configurar o webhook dessa instância apontando pro mesmo endpoint do
   Supabase (`whatsapp-webhook`, mesmo `EVOLUTION_WEBHOOK_SECRET`).
3. Gerar o QR code (`GET /instance/connect/<nome>`) e a clínica lê com o
   número dela.
4. A própria clínica cadastra `instancia_nome` + `numero_conectado` em
   Configurações → Instância Evolution API — RLS já garante que cada clínica
   só vê/edita a própria linha.

### Ponto de atenção futuro

O VPS de 4GB aguenta um número razoável de instâncias simultâneas. Se o
sistema crescer para muitas dezenas de clínicas ativas ao mesmo tempo, vale
avaliar um servidor maior — não é urgente hoje.

## Subdomínio por clínica (ex.: anna-carolina.sistemasdias.com.br)

**Status: feito.** Implementado via Caddy no VPS da Evolution API (sem custo
mensal extra), decisão tomada em 16/09/2026 em vez de esperar até "vender pra
clínica nova" — ver histórico abaixo pro contexto de por que tinha ficado
adiado antes.

### Como funciona

- **DNS**: registro.br **não aceita `*` no editor de zona** (nem domínio
  curinga verdadeiro) — por isso são registros `A` explícitos, um por
  clínica, todos apontando pro IP do VPS (`157.180.85.62`):
  `anna-carolina.sistemasdias.com.br` e `anna-munique.sistemasdias.com.br`.
- **Caddy** (`/root/evolution/Caddyfile` no VPS): um bloco por clínica, cada
  um faz `reverse_proxy` pra `https://sistemasdias.github.io` forçando o
  header `Host: sistemasdias.github.io` (é assim que o GitHub Pages aceita
  servir o conteúdo mesmo o visitante tendo chegado por outro domínio). O
  Caddy emite certificado HTTPS automático de verdade pra cada subdomínio na
  hora (mesmo mecanismo já usado em `evolution.sistemasdias.com.br`).
- **Código** ([config.js](config.js), `obterSlugClinicaDaUrl()`): além de
  `?c=slug`, agora também lê o slug direto do subdomínio
  (`window.location.hostname`), com `?c=` tendo prioridade quando presente.
  `www`, `evolution` e `sistemasdias` ficam reservados (nunca viram slug de
  clínica).

Link de cada clínica agora: `https://<slug-da-clinica>.sistemasdias.com.br`
(o antigo `sistemasdias.github.io/login.html?c=<slug>` continua funcionando
normalmente, é só uma forma alternativa de chegar no mesmo lugar).

### Onboarding de clínica nova — passo extra

Depois do passo 4 da seção "Onboarding" acima, pra dar subdomínio pra ela:

1. registro.br → `sistemasdias.com.br` → zona DNS → nova entrada `A`,
   nome = `<slug-da-clinica>`, dados = `157.180.85.62`.
2. No VPS, editar `/root/evolution/Caddyfile` e adicionar o bloco:
   ```
   <slug-da-clinica>.sistemasdias.com.br {
       reverse_proxy https://sistemasdias.github.io {
           header_up Host sistemasdias.github.io
       }
   }
   ```
3. Recarregar sem downtime: `docker exec evolution-caddy-1 caddy reload
   --config /etc/caddy/Caddyfile --adapter caddyfile`.

### Contexto histórico (por que tinha ficado adiado)

A Dra. Anna Munique caiu no login/agenda da Dra. Anna Carolina ao acessar o
sistema sem o parâmetro `?c=slug` na URL. Causa raiz corrigida no commit
`ef1e2c3`: [config.js](config.js) tinha um fallback fixo (`|| 'anna-carolina'`)
em `obterSlugClinicaDaUrl()` — sem `?c=`, o sistema assumia silenciosamente
a clínica da Anna Carolina. Isso foi corrigido primeiro (mensagem clara em
vez de adivinhar a clínica errada), e o subdomínio ficou adiado porque
GitHub Pages não suporta domínio customizado curinga — só um domínio por
repositório — e as opções eram: Vercel Pro (~$20/mês, mantém o site
independente do servidor de WhatsApp) ou Caddy no VPS da Evolution
(sem custo extra, mas acopla a disponibilidade do site à do VPS de
WhatsApp self-hosted). Optou-se pelo Caddy — esse acoplamento é o
trade-off aceito: se o VPS da Evolution cair, os subdomínios de clínica
caem junto (o acesso via `sistemasdias.github.io/login.html?c=slug`
continua no ar normalmente, pois não depende do VPS).
