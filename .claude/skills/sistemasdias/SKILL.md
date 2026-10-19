---
name: sistemasdias
description: Contexto e regras do projeto Sistemas Dias (sistema SaaS multi-clínica odontológica com Supabase, GitHub Pages e WhatsApp via Evolution API). Use sempre que mexer neste repositório — telas HTML, Edge Functions, migrações SQL, RLS, WhatsApp, assinaturas, onboarding de clínica, service worker ou deploy. Também use ao tocar em dados de pacientes (dados de saúde, LGPD).
---

# Sistemas Dias

Sistema web (PWA) para clínicas odontológicas, multi-tenant: uma base atende várias clínicas. O dono do produto é Claudio Gallego; cada clínica é cliente.

**Fonte da verdade:** `REGRAS.md` (como o projeto é operado) e `ROADMAP.md` (WhatsApp, subdomínios, onboarding). Leia os dois antes de decidir algo estrutural. Se uma decisão importante não estiver lá, ela não existe: ao tomar uma, registre em `REGRAS.md`.

## Arquitetura (resumo)

- **Front**: páginas HTML estáticas na raiz (`index.html`, `agenda-online.html`, `financeiro.html`, `estoque.html`, `paciente.html`, etc.), sem build. Config em `config.js`.
- **Banco e backend**: Supabase (produção). Tabelas, RLS e Edge Functions ficam lá; o código das funções fica em `supabase/functions/`.
- **Hospedagem**: GitHub Pages. Cada `git push` na `main` publica sozinho.
- **WhatsApp**: Evolution API em VPS próprio (Hetzner), fora deste repo. Ver `whatsapp-evolution/`.
- **App instalável**: `sw.js` serve os arquivos network-first; o cache só entra offline. `CACHE_NAME` só muda para forçar limpeza geral.
- **Backup**: workflow `.github/workflows/backup-diario.yml` e `backup.html`/`backup.js`.

## Regras que não podem ser quebradas

1. **Produção direta.** `main` publica na hora para todas as clínicas. Trabalhe em branch e só faça push na `main` quando o usuário pedir.
2. **Secrets nunca no código, em commit ou na conversa.** Ficam em Supabase → Edge Functions → Secrets. A chave anônima exposta no HTML é segura só porque a RLS protege os dados.
3. **Toda tabela nova de clínica** segue o padrão: `clinica_id uuid not null default current_clinica_id() references clinicas(id)`, policies com `clinica_id = current_clinica_id()`, escrita condicionada com `tem_permissao_secao('secao')` quando houver permissão dedicada. Tabela gravada só por Edge Function (service role) não recebe policy de insert/update/delete para `anon`/`authenticated`.
4. **Automação nova nasce desligada** (cron, disparo em massa) e só liga com pedido explícito.
5. **Painel de assinaturas** (`admin-assinaturas.html`) é do dono, não das clínicas. RLS de `assinaturas`, `pagamentos` e escrita em `clinicas` restrita ao e-mail do dono. Não afrouxe.
6. **`criar-clinica` x `criar-cliente-completo`**: a primeira usa senha fixa (`ADMIN_SECRET`) e nunca pode ser chamada do HTML público; o botão do painel usa a segunda (JWT + checagem do e-mail do dono). Não chame a primeira do front.
7. **PIN de clínica** é gerado no servidor e aparece uma única vez. Nunca registre, logue ou comite PIN.
8. **Trial de 14 dias** está em dois lugares: o cron `auto-bloquear-trials-vencidos` e `TRIAL_DIAS` em `admin-assinaturas.html`. Mudar um exige mudar o outro.
9. **Onboarding em três formatos**: guia (`ajuda.html`), roteiro (`admin-roteiro.html`) e o artefato externo descrevem a mesma lista de funcionalidades. Ao mudar o sistema, atualize os dois do repo e avise sobre o externo.

## Dados de pacientes (LGPD)

O sistema trata dados de saúde (anamnese, odontograma, documentos, orçamentos), que são dados pessoais sensíveis (LGPD art. 5º, II e art. 11).

- Não coloque dados reais de paciente em código, testes, commits, logs ou exemplos. Use dados fictícios.
- Não exporte nem copie dados de produção para fora do Supabase sem pedido explícito.
- Para questões de conformidade, use as skills `lgpd-compliance`, `lgpd-document-generator` e `lgpd-sanctions`. Política de privacidade e termos de uso do sistema estão em `politica-privacidade.html`, `termos-uso.html` e nos `.docx` da raiz.

## Como trabalhar aqui

- **Mudança de front**: edite o HTML direto; não há build. Teste abrindo a página e confira o comportamento offline (salvar sem internet deve bloquear e avisar, como já fazem as telas de orçamento).
- **Mudança de banco**: escreva SQL em arquivo versionado (`supabase/` ou `whatsapp-evolution/migrations/`), com RLS no mesmo arquivo. Mostre o SQL ao usuário antes de aplicar em produção. Nunca rode `DROP`, `TRUNCATE` ou `DELETE` sem `WHERE` em produção sem confirmação.
- **Edge Function**: defina `verify_jwt` de propósito. `true` quando chamada pelo front autenticado; `false` só para webhooks protegidos por segredo próprio.
- **Commits**: mensagens em português, descrevendo o efeito para o usuário (siga o estilo do `git log`). Um assunto por commit.
- **Antes de dizer que está pronto**: releia o diff, confira que nenhum secret, PIN ou dado de paciente entrou e diga o que não foi testado.
- Se o usuário reportar que "não vê a atualização" numa clínica: fechar todas as abas, abrir com internet; se persistir, apagar dados do site no navegador.
