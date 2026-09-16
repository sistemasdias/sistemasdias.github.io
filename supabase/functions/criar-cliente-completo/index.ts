// Edge Function: criar-cliente-completo
// Chamada só pelo painel admin-assinaturas.html (dono do produto). Faz o
// onboarding completo de uma clínica nova numa tacada só: assinatura,
// clínica, login (Auth) com PIN aleatório, usuário admin e config básica.
//
// Só quem está logado com o e-mail do dono (mesmo e-mail das policies
// "admin_full_access_*" no banco) pode chamar isso — verify_jwt:true garante
// que existe uma sessão válida, e o check de e-mail abaixo garante que é
// exatamente o dono, não qualquer usuário autenticado do sistema.
//
// O PIN de acesso é gerado aqui, aleatório — nunca escolhido/visto de
// antemão por quem programou isso. Só é devolvido uma vez na resposta pra
// quem chamou repassar pro cliente novo; não fica salvo em texto puro em
// lugar nenhum (o Supabase Auth já grava só o hash).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'claudiogallegoadv@gmail.com';

// Mesmo token/workflow que a função `criar-clinica` (mais antiga, de uso via
// chamada direta protegida por senha administrativa) já usa pra disparar um
// backup fora do horário agendado assim que uma clínica nova é criada — não
// bloqueia a resposta se falhar, já que a clínica entra no backup noturno
// de qualquer forma.
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN');
const GITHUB_REPO = 'sistemasdias/sistemasdias.github.io';
const GITHUB_WORKFLOW_ID = 'backup-diario.yml';

async function dispararBackupImediato() {
  if (!GITHUB_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_ID}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function gerarPin(tamanho = 4): string {
  let pin = '';
  for (let i = 0; i < tamanho; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

// Manda a mensagem de boas-vindas pelo WhatsApp do próprio dono do sistema
// (instância separada das instâncias de cada clínica, que são pra elas
// falarem com os pacientes delas). Não bloqueia a criação do cliente se
// falhar (WhatsApp desconectado, etc) — quem chama decide se quer avisar
// manualmente nesse caso.
// Não é um valor sensível (é só um nome de instância, não uma chave/senha),
// por isso fica direto no código em vez de exigir mais um secret configurado
// manualmente no Supabase.
const ADMIN_WHATSAPP_INSTANCE = 'sistemasdias-admin';

async function enviarBoasVindasWhatsApp(telefoneContato: string, nomeUsuario: string, slug: string, emailLogin: string, pin: string): Promise<boolean> {
  const evolutionUrl = Deno.env.get('EVOLUTION_API_URL');
  const evolutionKey = Deno.env.get('EVOLUTION_API_KEY');
  if (!evolutionUrl || !evolutionKey) return false;

  const linkAcesso = `https://sistemasdias.github.io/login.html?c=${slug}`;
  const texto = `Olá, ${nomeUsuario}! Tudo bem? 🎉\n\nSeu acesso ao sistema já está pronto:\n\n🔗 Link: ${linkAcesso}\n📧 E-mail: ${emailLogin}\n🔑 PIN de acesso: ${pin}\n\nQualquer dúvida, me chama por aqui!`;

  try {
    const res = await fetch(`${evolutionUrl}/message/sendText/${ADMIN_WHATSAPP_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
      body: JSON.stringify({ number: telefoneContato, text: texto }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Não autenticado.' }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user || userData.user.email !== ADMIN_EMAIL) {
      return jsonResponse({ error: 'Não autorizado.' }, 403);
    }

    const body = await req.json();
    const nomeClinica = String(body?.nomeClinica || '').trim();
    const slug = String(body?.slug || '').trim().toLowerCase();
    const valorMensal = Number(body?.valorMensal);
    const diaVencimento = parseInt(body?.diaVencimento, 10);
    const plano = body?.plano === 'ativo' ? 'ativo' : 'trial';
    const telefoneContato = String(body?.telefoneContato || '').replace(/\D/g, '') || null;
    const emailLogin = String(body?.emailLogin || '').trim().toLowerCase();
    const nomeUsuario = String(body?.nomeUsuario || '').trim();

    if (!nomeClinica || !slug || !emailLogin || !nomeUsuario) {
      return jsonResponse({ error: 'Preencha nome da clínica, identificador, e-mail de login e nome do usuário.' }, 400);
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return jsonResponse({ error: 'Identificador deve ter só letras minúsculas, números e hífen (sem espaço ou acento).' }, 400);
    }
    if (!Number.isFinite(valorMensal) || valorMensal <= 0) {
      return jsonResponse({ error: 'Valor mensal inválido.' }, 400);
    }
    if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) {
      return jsonResponse({ error: 'Dia de vencimento deve ser entre 1 e 28.' }, 400);
    }

    // 1. Assinatura — falha aqui (ex: identificador duplicado) impede tudo
    // o resto, sem deixar nada pela metade.
    const { error: erroAssinatura } = await adminClient.from('assinaturas').insert({
      nome_cliente: nomeClinica,
      tenant_id: slug,
      valor_mensal: valorMensal,
      dia_vencimento: diaVencimento,
      telefone_contato: telefoneContato,
      status: 'ativo',
    });
    if (erroAssinatura) {
      return jsonResponse({ error: 'Erro ao criar assinatura: ' + erroAssinatura.message }, 400);
    }

    // 2. Clínica — reaproveita se já existir uma com esse slug.
    let clinicaId: string | null = null;
    const { data: clinicaExistente } = await adminClient
      .from('clinicas').select('id').eq('slug', slug).maybeSingle();
    if (clinicaExistente) {
      clinicaId = clinicaExistente.id;
    } else {
      const { data: novaClinica, error: erroClinica } = await adminClient
        .from('clinicas')
        .insert({ nome: nomeClinica, slug, plano, status: 'ativa' })
        .select('id')
        .single();
      if (erroClinica) {
        return jsonResponse({ error: 'Assinatura criada, mas houve erro ao criar a clínica: ' + erroClinica.message }, 500);
      }
      clinicaId = novaClinica.id;
    }

    // 3. Se essa clínica já tem config (ou seja, já foi onboardada antes),
    // não mexe no login dela de novo — só a assinatura acima já resolve o
    // caso de "reativar cobrança de clínica que já existe".
    const { data: configExistente } = await adminClient
      .from('config_clinica').select('id').eq('clinica_id', clinicaId).maybeSingle();
    if (configExistente) {
      return jsonResponse({ ok: true, clinicaId, slug, contaJaExistia: true });
    }

    // 4. Login (Supabase Auth) com PIN aleatório.
    const pin = gerarPin(4);
    const { data: novoAuthUser, error: erroAuth } = await adminClient.auth.admin.createUser({
      email: emailLogin,
      password: pin,
      email_confirm: true,
    });
    if (erroAuth || !novoAuthUser?.user) {
      return jsonResponse({ error: 'Assinatura e clínica criadas, mas houve erro ao criar o login: ' + (erroAuth?.message || 'falha desconhecida'), clinicaId, slug }, 500);
    }

    // 5. Usuário admin da clínica.
    const { error: erroUsuario } = await adminClient.from('usuarios').insert({
      id: novoAuthUser.user.id,
      nome: nomeUsuario,
      email: emailLogin,
      clinica_id: clinicaId,
      eh_admin: true,
      ativo: true,
    });
    if (erroUsuario) {
      return jsonResponse({ error: 'Login criado, mas houve erro ao vincular o usuário: ' + erroUsuario.message, clinicaId, slug, emailLogin, pin }, 500);
    }

    // 6. Config básica da clínica (nome — o resto ela ajusta em Configurações).
    const { error: erroConfig } = await adminClient.from('config_clinica').insert({
      clinica_id: clinicaId,
      nome: nomeClinica,
    });
    if (erroConfig) {
      return jsonResponse({ error: 'Login e usuário criados, mas houve erro ao criar a configuração da clínica: ' + erroConfig.message, clinicaId, slug, emailLogin, pin }, 500);
    }

    const backupDisparado = await dispararBackupImediato();

    let whatsappEnviado = false;
    if (telefoneContato) {
      whatsappEnviado = await enviarBoasVindasWhatsApp(telefoneContato, nomeUsuario, slug, emailLogin, pin);
    }

    return jsonResponse({ ok: true, clinicaId, slug, emailLogin, pin, contaJaExistia: false, backupDisparado, whatsappEnviado });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
});
