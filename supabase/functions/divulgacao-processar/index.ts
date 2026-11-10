// Edge Function: divulgacao-processar
// Chamada a cada minuto pelo pg_cron. Envia no máximo UMA mensagem por clínica por chamada,
// respeitando intervalo, limite por dia e horário de cada divulgação (regras em fila.mjs,
// fluxo em processar.mjs).
//
// verify_jwt: false — quem chama é o banco, não um usuário. A proteção é o header
// x-cron-secret, conferido contra o Vault pela função SQL divulgacao_cron_confere().
// Sem segredo criado no Vault, a função recusa tudo (nasce desligada).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { processarFila } from './processar.mjs';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const segredo = req.headers.get('x-cron-secret') || '';
    const { data: autorizado } = await adminClient.rpc('divulgacao_cron_confere', { p_segredo: segredo });
    if (autorizado !== true) return jsonResponse({ error: 'Não autorizado.' }, 401);

    const evolutionUrl = Deno.env.get('EVOLUTION_API_URL')!;
    const evolutionKey = Deno.env.get('EVOLUTION_API_KEY')!;

    const enviar = async ({ instancia, numero, texto, divulgacao }: {
      instancia: string; numero: string; texto: string; divulgacao: Record<string, any>;
    }) => {
      let caminho = `message/sendText/${instancia}`;
      let corpo: Record<string, unknown> = { number: numero, text: texto, delay: 2000 };

      if (divulgacao.midia_caminho) {
        // Link temporário do anexo: a Evolution baixa o arquivo e manda como vídeo/imagem do WhatsApp
        const { data: link, error: linkErro } = await adminClient.storage
          .from('divulgacao-midia')
          .createSignedUrl(divulgacao.midia_caminho, 900);
        if (linkErro || !link?.signedUrl) {
          return { ok: false, erro: 'Anexo não encontrado: ' + (linkErro?.message || 'sem link') };
        }
        caminho = `message/sendMedia/${instancia}`;
        corpo = {
          number: numero,
          mediatype: divulgacao.midia_tipo || 'video',
          mimetype: divulgacao.midia_mime || undefined,
          caption: texto,
          media: link.signedUrl,
          fileName: divulgacao.midia_nome || 'divulgacao',
          delay: 2000,
        };
      }

      const r = await fetch(`${evolutionUrl}/${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = d?.response?.message ?? d?.message ?? d?.error ?? `Evolution API retornou ${r.status}`;
        return { ok: false, erro: typeof msg === 'string' ? msg : JSON.stringify(msg) };
      }
      return { ok: true, id: d?.key?.id || d?.message?.key?.id || null };
    };

    const resumo = await processarFila(adminClient, enviar);
    return jsonResponse({ ok: true, ...resumo });
  } catch (e) {
    console.error('[divulgacao-processar]', e);
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
