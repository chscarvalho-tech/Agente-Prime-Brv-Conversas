// Servidor do agente: recebe os webhooks do WA-AKG e mantém o agente trabalhando.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv, criarApp } from './lib/app.js';
import { localizarClaude } from './lib/cerebro.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
carregarEnv(raiz);

const PORT = Number(process.env.PORT || 3200);
const SEGREDO = process.env.WEBHOOK_SECRET || '';

const { config, memoria, motor, wa } = await criarApp({ raiz });
const { erros, avisos } = config.validar();
for (const a of avisos) console.warn('[aviso]', a);
if (erros.length) {
  for (const e of erros) console.error('[erro]', e);
  console.error('Corrija os erros acima (node cli.js validar) antes de iniciar.');
  process.exit(1);
}
if (!localizarClaude()) console.warn('[aviso] Claude Code não encontrado: o agente não conseguirá responder. Veja CLAUDE_BIN no .env.');
if (!SEGREDO) console.warn('[aviso] WEBHOOK_SECRET vazio: o webhook aceita chamadas sem assinatura.');

function lerCorpo(req, limite = 2 * 1024 * 1024) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tam = 0;
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { falha(new Error('corpo grande demais')); req.destroy(); } else partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falha);
  });
}

function assinaturaValida(bruto, cabecalho) {
  if (!SEGREDO) return true;
  const recebida = String(cabecalho || '').replace(/^sha256=/, '');
  const esperada = crypto.createHmac('sha256', SEGREDO).update(bruto).digest('hex');
  return recebida.length === esperada.length && crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/saude') return json(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const bruto = await lerCorpo(req);
      if (!assinaturaValida(bruto, req.headers['x-webhook-signature'])) return json(res, 401, { erro: 'assinatura inválida' });
      let payload;
      try { payload = JSON.parse(bruto.toString('utf8')); } catch { return json(res, 400, { erro: 'json inválido' }); }
      json(res, 200, { ok: true });
      motor.receberWebhook(payload).catch((e) => console.error('[webhook]', e));
      return;
    }
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) json(res, 500, { erro: 'erro interno' });
  }
});

servidor.listen(PORT, () => {
  const ag = config.agente();
  console.log(`${ag.nome_agente} (${ag.empresa}) ouvindo na porta ${PORT}. Webhook: ${process.env.PUBLIC_URL || `http://localhost:${PORT}`}/webhook`);
  console.log(`CRM: ${config.crm().modo} · WhatsApp: ${wa.configurado ? `sessão ${wa.sessao}` : 'não configurado'} · Claude: ${ag.claude?.usar_chave_api ? 'chave de API' : 'login do Claude Code'} (${ag.claude?.modelo || 'sonnet'})`);
});

// A cada 5 minutos: reenvia ao CRM o que falhou.
setInterval(() => {
  motor.reenviarPendentesCrm().then((n) => { if (n) console.log(`[crm] ${n} lead(s) pendente(s) reenviado(s)`); }).catch((e) => console.error('[crm]', e.message));
}, 5 * 60 * 1000).unref();

const sair = () => { servidor.close(); memoria.db.close(); process.exit(0); };
process.on('SIGINT', sair);
process.on('SIGTERM', sair);
