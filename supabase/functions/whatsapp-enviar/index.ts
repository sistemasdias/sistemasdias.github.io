// Edge Function: whatsapp-enviar
// Chamada pelo frontend (usuário logado) para mandar uma mensagem de texto
// pela instância Evolution API da própria clínica. A EVOLUTION_API_URL e a
// EVOLUTION_API_KEY nunca chegam ao navegador — ficam só como secrets aqui.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  let clinicaId: string | null = null;
  let usuarioId: string | null = null;
  let instanciaNome: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Não autenticado.' }, 401);
    }

    // 1. Confirma que quem está chamando é um usuário logado de verdade
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
    }
    usuarioId = userData.user.id;

    // 2. Descobre a clínica de quem está chamando
    const { data: chamador, error: chamadorError } = await adminClient
      .from('usuarios')
      .select('clinica_id')
      .eq('id', usuarioId)
      .maybeSingle();
    if (chamadorError || !chamador?.clinica_id) {
      return jsonResponse({ error: 'Não foi possível identificar a clínica do usuário.' }, 400);
    }
    clinicaId = chamador.clinica_id;

    // 3. Lê os dados da mensagem
    const { paciente_id, numero, texto } = await req.json();
    if (!numero || !texto) {
      return jsonResponse({ error: 'Informe número e texto da mensagem.' }, 400);
    }
    const numeroLimpo = String(numero).replace(/\D/g, '');
    if (!numeroLimpo) {
      return jsonResponse({ error: 'Número inválido.' }, 400);
    }

    // 4. Acha a instância Evolution ativa da clínica
    const { data: instancia, error: instanciaError } = await adminClient
      .from('whatsapp_instancias')
      .select('instancia_nome')
      .eq('clinica_id', clinicaId)
      .eq('ativo', true)
      .order('criado_em', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (instanciaError || !instancia?.instancia_nome) {
      return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa cadastrada para esta clínica.' }, 400);
    }
    instanciaNome = instancia.instancia_nome;

    // 5. Chama a Evolution API
    const evolutionUrl = Deno.env.get('EVOLUTION_API_URL')!;
    const evolutionKey = Deno.env.get('EVOLUTION_API_KEY')!;
    const r = await fetch(`${evolutionUrl}/message/sendText/${instanciaNome}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
      body: JSON.stringify({ number: numeroLimpo, text: texto }),
    });
    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      const erro = d?.message || d?.error || `Evolution API retornou ${r.status}`;
      await adminClient.from('whatsapp_mensagens_enviadas').insert({
        clinica_id: clinicaId,
        instancia_nome: instanciaNome,
        paciente_id: paciente_id || null,
        numero: numeroLimpo,
        texto,
        status: 'erro',
        erro: String(erro),
        enviado_por: usuarioId,
      });
      return jsonResponse({ error: erro }, 502);
    }

    const evolutionMessageId = d?.key?.id || d?.message?.key?.id || null;

    await adminClient.from('whatsapp_mensagens_enviadas').insert({
      clinica_id: clinicaId,
      instancia_nome: instanciaNome,
      paciente_id: paciente_id || null,
      numero: numeroLimpo,
      texto,
      evolution_message_id: evolutionMessageId,
      status: 'enviado',
      enviado_por: usuarioId,
    });

    return jsonResponse({ ok: true, evolution_message_id: evolutionMessageId });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
});
