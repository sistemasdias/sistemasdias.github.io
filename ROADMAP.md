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

**Desde 16/09/2026, os passos 1-2 abaixo já são automáticos** — a Edge
Function `criar-cliente-completo` (chamada pelo botão "+ Novo cliente" do
[admin-assinaturas.html](admin-assinaturas.html)) já cria a instância
`clinica-<slug>`, configura o webhook e o filtro de grupo sozinha. Só
sobra o passo 3 (escanear o QR), que exige o celular físico da clínica.

1. ~~Criar a instância na Evolution API~~ — automático.
2. ~~Configurar o webhook dessa instância~~ — automático.
3. Gerar o QR code (`GET /instance/connect/<nome>`) e a clínica lê com o
   número dela — via Manager, ver "Como conectar" acima.
4. A própria clínica pode revisar/ajustar `numero_conectado` em
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

## Pendências e ideias (atualizado em 20/10/2026)

### Conciliação da taxa do cartão (partes 1 e 2 feitas em 20/10/2026)

**Feito:** cada clínica informa as próprias taxas em Configurações → "Taxas da maquininha"
(`config_clinica.taxas_cartao`); um trigger em `financeiro` grava `taxa_cartao_pct` e
`valor_liquido` nos lançamentos novos de cartão (migração em `supabase/migrations/`).
A lista do Financeiro mostra o líquido. **Parte 2 feita:** faixa "cartão a conferir"
no Financeiro (função `conferir_cartao`) — a pessoa confirma "bateu" ou informa o que caiu de verdade, e a
diferença vira lançamento de ajuste. Texto original do problema abaixo.


Hoje pagamento no cartão (inclusive parcelado) entra no financeiro como
**recebido à vista, pelo valor cheio**. Na prática a clínica recebe da
operadora **líquido** (taxa descontada) e, se antecipar, em outra data. Isso
faz o valor lançado diferir do que cai na conta.

A definir com a Dra.: (a) lançar só o bruto e ter um campo "taxa" / "valor
líquido" por lançamento; (b) taxa % configurável por forma de pagamento
(débito, crédito 1x, crédito parcelado) em Configurações, calculando o líquido
sozinho; (c) tela de conciliação com o extrato da operadora. Sugestão para
começar: (b), pois não muda o fluxo de quem lança.

### Ideias da análise de 20/10/2026

**Feitas em 20/10/2026:**
- Fechamento guiado da agenda: faixa na Tela Hoje com "Compareceu / Faltou / Cancelada"
  para consultas passadas sem resultado.
- Consultas ligadas às pacientes: ao agendar e ao aprovar pedido online (telefone único
  ou nome exato). As consultas antigas seguras foram ligadas (80); sobraram 120 sem
  paciente (ambíguas e compromissos pessoais). Backup dos ids: tabela
  `bkp_agenda_vinculo_20261020` no Supabase.
- Reativação: bloco "Pacientes sem voltar" em Relatórios (6/12/18 meses), envio manual
  por WhatsApp; a data do contato fica em `pacientes.retornos_status.__reativacao`.

**Feitas também (20/10/2026):** painel de saúde por clínica no admin-assinaturas; onboarding com dados de exemplo
(faixa na Tela Hoje de clínica vazia; `criar_dados_exemplo` / `remover_dados_exemplo`, coluna `exemplo`
em pacientes, agenda e financeiro).

**Medição da reativação (20/10/2026):** o bloco "Pacientes sem voltar" mostra chamadas dos últimos 120 dias e
quantas voltaram a agendar (`retornos_status.__reativacao_chamada`; "Agora não" não conta como chamada).

**Testes automáticos (20/10/2026):** 93 testes em `tests/` (`npm test`), rodando também no GitHub.

**Pix nas cobranças (21/10/2026):** Configurações → "Pix para cobranças" (`config_clinica.pix_chave` / `pix_titular`);
as mensagens da aba Cobranças incluem a chave quando configurada. Não gera QR nem "copia e cola" com valor.

**Documentos (21/10/2026):** impressão em A4 revisada com PDF real (termos e autorização em 1 folha; anamnese
odontológica em 2; rubrica e "Pág. x/y" nos de várias folhas; cidade/data por extenso nas assinaturas; carimbo nome+registro
nos receituários; logo do mesmo tamanho em todos). Também corrigida a data "de hoje" em UTC (virava amanhã após as 21h).

**Ainda não iniciadas:**
- **Faturamento líquido nos relatórios**, usando `financeiro.valor_liquido`, quando as
  clínicas já tiverem as taxas preenchidas.
- **Testes do banco e do visual** (RLS, funções SQL, telas no navegador): os testes de hoje cobrem só
  sintaxe, estrutura e regras em JavaScript (ver REGRAS.md → Testes automáticos).
