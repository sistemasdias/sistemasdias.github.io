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

### Falta

- [ ] **Ler o QR code com o celular** que será o número oficial de WhatsApp
      da clínica (Configurações → Aparelhos conectados → Conectar um
      aparelho, no WhatsApp do celular). É o único passo que depende de uma
      pessoa fisicamente — sem isso, `whatsapp-enviar` responde
      "nenhuma instância ativa" na prática (a instância existe mas está sem
      número conectado).
      QR expira em ~1 min — gerar um novo é rápido (`GET
      /instance/connect/clinica-anna` na Evolution API com a apikey).

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

**Status: adiado, não é prioridade.** Registrado aqui pra não se perder.

### Contexto

A Dra. Anna Munique caiu no login/agenda da Dra. Anna Carolina ao acessar o
sistema sem o parâmetro `?c=slug` na URL. Causa raiz corrigida no commit
`ef1e2c3`: [config.js](config.js) tinha um fallback fixo (`|| 'anna-carolina'`)
em `obterSlugClinicaDaUrl()` — sem `?c=`, o sistema assumia silenciosamente
a clínica da Anna Carolina, tanto no login quanto no agendamento online
público. Isso já foi corrigido: hoje, sem o parâmetro, aparece uma mensagem
clara ("Link de acesso incompleto") em vez de assumir a clínica errada.

Link correto de cada clínica, enquanto não existir subdomínio:
`sistemasdias.github.io/login.html?c=<slug-da-clinica>`.

### Por que subdomínio ainda seria uma melhoria (não urgente)

- Link mais fácil de lembrar/vender: `suaclinica.sistemasdias.com.br` em vez
  de `?c=slug`.
- Isolamento de origem de verdade no navegador (cada subdomínio tem seu
  próprio `localStorage`), em vez de depender só do código pra não misturar
  dados de clínicas diferentes na mesma origem.

### Por que está adiado

GitHub Pages (onde o site é hospedado hoje, de graça) **não suporta domínio
curinga** (`*.sistemasdias.com.br`) — só aceita um domínio customizado por
repositório. As duas opções avaliadas:

- **Vercel**: suporta domínio curinga nativamente, mas o plano gratuito
  ("Hobby") é só para uso pessoal/não-comercial — pra um sistema vendido
  pra clínicas, seria necessário o plano Pro (~$20/mês, conferir preço atual
  em vercel.com/pricing). Custo mensal recorrente novo.
- **Caddy no VPS da Evolution API**: usar o Caddy que já roda lá como
  roteador do domínio curinga na frente do GitHub Pages. Sem custo mensal
  extra (o VPS já é pago), mas acopla a disponibilidade do site principal à
  do servidor de WhatsApp self-hosted (menos estável, pode cair/precisar
  reiniciar) — hoje são independentes.

### Recomendação

Fazer quando o sistema estiver **ativamente sendo vendido pra clínicas
novas** e a aparência do link pesar na decisão — não antes disso. Se/quando
for a hora, decidir entre as duas opções acima (ou reavaliar preços/opções
novas na época).
