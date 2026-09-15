// Edge Function: whatsapp-webhook
// Recebe os eventos MESSAGES_UPSERT que a Evolution API dispara a cada
// mensagem (enviada ou recebida) de uma instância conectada.
// Não usa verify_jwt — a Evolution não manda um JWT do Supabase, então a
// própria Evolution deve ser configurada com o header/segredo abaixo.
// Só grava com a service_role key, que ignora RLS por natureza.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extrairTexto(message: Record<string, unknown> | undefined | null): string {
  if (!message) return '';
  const m = message as Record<string, any>;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Segredo compartilhado opcional — se EVOLUTION_WEBHOOK_SECRET estiver
    // configurado como secret do projeto, exige que a Evolution o envie de
    // volta (header x-webhook-secret ou ?secret= na URL do webhook).
    const segredoEsperado = Deno.env.get('EVOLUTION_WEBHOOK_SECRET');
    if (segredoEsperado) {
      const url = new URL(req.url);
      const recebido = req.headers.get('x-webhook-secret') || url.searchParams.get('secret');
      if (recebido !== segredoEsperado) {
        return jsonResponse({ error: 'Não autorizado.' }, 401);
      }
    }

    const body = await req.json();
    const evento = String(body?.event || '').toLowerCase().replace(/_/g, '.');
    if (evento !== 'messages.upsert') {
      return jsonResponse({ ok: true, ignorado: true });
    }

    const instanciaNome = body?.instance;
    if (!instanciaNome) {
      return jsonResponse({ error: 'Evento sem instância.' }, 400);
    }

    // A Evolution pode mandar `data` como objeto único ou como array,
    // dependendo da versão/configuração.
    const itens = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
    if (!itens.length) {
      return jsonResponse({ ok: true, semDados: true });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: instancia, error: instanciaError } = await adminClient
      .from('whatsapp_instancias')
      .select('clinica_id')
      .eq('instancia_nome', instanciaNome)
      .maybeSingle();
    if (instanciaError || !instancia?.clinica_id) {
      return jsonResponse({ error: 'Instância não cadastrada.' }, 404);
    }

    const linhas = itens
      .map((item: Record<string, any>) => {
        const messageId = item?.key?.id;
        if (!messageId) return null;
        // Só conversas individuais: grupos (@g.us) e status/broadcast são
        // conversa pessoal do número da clínica, não têm relação com paciente
        // e não devem ser armazenados (LGPD / minimização de dados).
        const jid = String(item?.key?.remoteJid || '');
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
        return {
          clinica_id: instancia.clinica_id,
          instancia_nome: instanciaNome,
          message_id: messageId,
          remote_jid: item?.key?.remoteJid || null,
          texto: extrairTexto(item?.message) || null,
          from_me: !!item?.key?.fromMe,
          payload_bruto: item,
        };
      })
      .filter(Boolean);

    if (!linhas.length) {
      return jsonResponse({ ok: true, semMessageId: true });
    }

    // Idempotente: duplicata por message_id é ignorada em vez de dar erro.
    const { error: insertError } = await adminClient
      .from('whatsapp_mensagens_recebidas')
      .upsert(linhas, { onConflict: 'message_id', ignoreDuplicates: true });

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({ ok: true, gravadas: linhas.length });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
});
