// Testes automáticos: sem Claude, sem WhatsApp e com um CRM falso. Rode com: npm run testes
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { criarApp } from '../lib/app.js';
import { criarCrm, preencherModelo, pegar } from '../lib/crm.js';
import { montarSistema, esquemaSaida, montarPedido } from '../lib/cerebro.js';
import { Config } from '../lib/config.js';

const raizRepo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const EQUIPE = '5511988887777';

// ---------- raiz temporária com a configuração do repositório, ajustada para teste ----------
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-teste-'));
fs.cpSync(path.join(raizRepo, 'config'), path.join(raiz, 'config'), { recursive: true });
fs.cpSync(path.join(raizRepo, 'conhecimento'), path.join(raiz, 'conhecimento'), { recursive: true });
const ag = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'agente.json'), 'utf8'));
Object.assign(ag, { aguardar_segundos: 0.15, simular_digitacao: false });
fs.writeFileSync(path.join(raiz, 'config', 'agente.json'), JSON.stringify(ag));
const et = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'etapas.json'), 'utf8'));
et.destinos[0].whatsapp = EQUIPE;
fs.writeFileSync(path.join(raiz, 'config', 'etapas.json'), JSON.stringify(et));

// ---------- CRM falso (API REST + PostgREST do Supabase) ----------
const crmDb = { leads: [], notas: [], fora: false, seq: 100 };
const servidorCrm = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let corpo = '';
  for await (const c of req) corpo += c;
  const b = corpo ? JSON.parse(corpo) : {};
  const enviar = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (crmDb.fora) return enviar(503, { erro: 'fora do ar' });
  if (req.headers.authorization !== 'Bearer token-teste') return enviar(401, { erro: 'sem token' });
  // REST
  if (url.pathname === '/api/leads' && req.method === 'GET') return enviar(200, crmDb.leads.filter((l) => l.telefone === url.searchParams.get('telefone')));
  if (url.pathname === '/api/leads' && req.method === 'POST') { const l = { id: ++crmDb.seq, ...b }; crmDb.leads.push(l); return enviar(201, l); }
  let m = url.pathname.match(/^\/api\/leads\/(\d+)$/);
  if (m && req.method === 'PATCH') { const l = crmDb.leads.find((x) => x.id === Number(m[1])); Object.assign(l, b); return enviar(200, l); }
  m = url.pathname.match(/^\/api\/leads\/(\d+)\/notas$/);
  if (m && req.method === 'POST') { crmDb.notas.push({ lead: Number(m[1]), ...b }); return enviar(201, {}); }
  // Supabase
  if (url.pathname === '/rest/v1/contatos') {
    if (req.headers.apikey !== 'token-teste') return enviar(401, {});
    if (req.method === 'GET') {
      const tel = (url.searchParams.get('fone') || '').replace(/^eq\./, '');
      return enviar(200, crmDb.leads.filter((l) => l.fone === tel).map((l) => ({ uid: l.uid })));
    }
    if (req.method === 'POST') { const l = { uid: `u${++crmDb.seq}`, ...b }; crmDb.leads.push(l); return enviar(201, [l]); }
    if (req.method === 'PATCH') {
      const uid = (url.searchParams.get('uid') || '').replace(/^eq\./, '');
      Object.assign(crmDb.leads.find((l) => l.uid === uid), b); res.writeHead(204); return res.end();
    }
  }
  enviar(404, {});
});
await new Promise((ok) => servidorCrm.listen(0, ok));
const CRM_URL = `http://127.0.0.1:${servidorCrm.address().port}`;
process.env.CRM_URL = CRM_URL;
process.env.CRM_TOKEN = 'token-teste';

const cfgHttp = {
  modo: 'http', formato_telefone: 'digitos',
  http: {
    base_url: CRM_URL, cabecalhos: { Authorization: 'Bearer token-teste' },
    buscar_por_telefone: { metodo: 'GET', caminho: '/api/leads?telefone={telefone}', id_no_resultado: '0.id' },
    criar: { metodo: 'POST', caminho: '/api/leads', corpo: { nome: '{nome}', telefone: '{telefone}', origem: 'WhatsApp', etapa: '{etapa_crm}', $campos: true }, id_no_resultado: 'id' },
    atualizar: { metodo: 'PATCH', caminho: '/api/leads/{crm_id}', corpo: { etapa: '{etapa_crm}', resumo: '{resumo}', nome: '{nome}', $campos: true } },
    registrar_nota: { metodo: 'POST', caminho: '/api/leads/{crm_id}/notas', corpo: { texto: '{nota}' } },
  },
};

// ---------- WhatsApp falso e Claude roteirizado ----------
const enviados = [];
const wa = {
  configurado: true, sessao: 'teste',
  async enviarTexto(jid, texto) { enviados.push({ jid, texto }); return `out-${enviados.length}`; },
  async digitando() {},
};
const roteiro = [];
let chamadasIA = 0;
let ultimoPedido = null;
const cerebro = {
  async pensar(p) {
    chamadasIA++;
    ultimoPedido = p;
    const prox = roteiro.shift();
    if (!prox) throw new Error('roteiro vazio');
    if (prox instanceof Error) throw prox;
    return { saida: prox, uso: { modelo: 'roteiro', entrada: 10, saida: 5 } };
  },
};

const crm = await criarCrm(cfgHttp, raiz);
const { motor, memoria } = await criarApp({ raiz, arquivoBanco: ':memory:', cerebro, crm, wa });
motor.log = { error() {}, log() {} };

let idMsg = 0;
const msg = (tel, texto, extra = {}) => motor.receberWebhook({
  event: 'message.received',
  data: { key: { id: `in-${++idMsg}`, remoteJid: `${tel}@s.whatsapp.net`, fromMe: false }, from: `${tel}@s.whatsapp.net`, pushName: 'Carla Souza', type: 'TEXT', content: texto, chatType: 'PERSONAL', ...extra },
});
const esperar = () => dormir(600);
const paraLead = (tel) => enviados.filter((e) => e.jid === `${tel}@s.whatsapp.net`).map((e) => e.texto);

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

// ================= cenários =================

teste('primeira mensagem cria o lead no CRM e responde', async () => {
  roteiro.push({ mensagens: ['Oi, Carla! Sou a assistente virtual da Prime Brv.', 'Você procura qual produto?'], etapa: 'novo', acao: 'responder', resumo: 'Primeiro contato.', dados: { nome: 'Carla Souza' } });
  await msg('5511911110001', 'oi, vi o anúncio');
  await esperar();
  const lead = crmDb.leads.find((l) => l.telefone === '5511911110001');
  assert.ok(lead, 'lead criado no CRM');
  assert.equal(lead.origem, 'WhatsApp');
  assert.equal(lead.etapa, 'Novo');
  assert.deepEqual(paraLead('5511911110001'), ['Oi, Carla! Sou a assistente virtual da Prime Brv.', 'Você procura qual produto?']);
  const c = memoria.conversaPorTelefone('5511911110001');
  assert.equal(c.crm_id, String(lead.id));
  assert.equal(lead.resumo, 'Primeiro contato.');
});

teste('qualifica: muda etapa e grava campos mapeados e nota no CRM', async () => {
  roteiro.push({ mensagens: ['Perfeito. Qual valor você precisa?'], etapa: 'em_qualificacao', acao: 'responder', resumo: 'Quer o exemplo A.', dados: { interesse: 'exemplo A', cidade: 'Campinas/SP' }, motivo: 'disse o produto' });
  await msg('5511911110001', 'quero o exemplo A, sou de Campinas');
  await esperar();
  const lead = crmDb.leads.find((l) => l.telefone === '5511911110001');
  assert.equal(lead.etapa, 'Em qualificação');
  assert.equal(lead.interesse, 'exemplo A');
  assert.equal(lead.cidade, 'Campinas/SP');
  assert.ok(crmDb.notas.some((n) => n.lead === lead.id && /Novo contato → Em qualificação/.test(n.texto)));
  // o pedido ao Claude leva os dados já coletados
  assert.equal(ultimoPedido.conversa.dados.nome, 'Carla Souza');
});

teste('lead que já existe no CRM é vinculado, não duplicado', async () => {
  crmDb.leads.push({ id: 7, telefone: '5511911110002', nome: 'Já Cliente', etapa: 'Qualificado' });
  roteiro.push({ mensagens: ['Oi!'], etapa: 'novo', acao: 'responder', resumo: 'Voltou a falar.' });
  await msg('5511911110002', 'oi de novo');
  await esperar();
  assert.equal(crmDb.leads.filter((l) => l.telefone === '5511911110002').length, 1);
  assert.equal(memoria.conversaPorTelefone('5511911110002').crm_id, '7');
});

teste('mensagens seguidas viram uma resposta só', async () => {
  const antes = chamadasIA;
  roteiro.push({ mensagens: ['Entendi tudo.'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  await msg('5511911110003', 'oi');
  await msg('5511911110003', 'tudo bem?');
  await msg('5511911110003', 'queria uma informação');
  await esperar();
  assert.equal(chamadasIA - antes, 1);
  assert.deepEqual(paraLead('5511911110003'), ['Entendi tudo.']);
});

teste('transferência: avisa a equipe, grava no CRM e para de responder', async () => {
  roteiro.push({ mensagens: ['Vou te passar para a nossa especialista.'], etapa: 'qualificado', acao: 'transferir', destino_id: 'comercial', motivo: 'pediu atendente', resumo: 'Quer falar com pessoa.' });
  await msg('5511911110001', 'quero falar com uma pessoa');
  await esperar();
  const aviso = enviados.find((e) => e.jid === `${EQUIPE}@s.whatsapp.net`);
  assert.ok(aviso, 'equipe avisada');
  assert.match(aviso.texto, /wa\.me\/5511911110001/);
  assert.match(aviso.texto, /Lead no CRM/);
  const lead = crmDb.leads.find((l) => l.telefone === '5511911110001');
  assert.equal(lead.etapa, 'Encaminhado');
  assert.ok(crmDb.notas.some((n) => n.lead === lead.id && /Transferido para Equipe comercial/.test(n.texto)));
  const antes = chamadasIA;
  await msg('5511911110001', 'alô?');
  await esperar();
  assert.equal(chamadasIA, antes, 'agente não responde depois de transferir');
});

teste('equipe respondendo pelo celular pausa o agente', async () => {
  roteiro.push({ mensagens: ['Oi!'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  await msg('5511911110004', 'oi');
  await esperar();
  await motor.receberWebhook({ event: 'message.sent', data: { key: { id: 'humano-1', remoteJid: '5511911110004@s.whatsapp.net', fromMe: true }, type: 'TEXT', content: 'Oi, aqui é a Júlia da equipe' } });
  const c = memoria.conversaPorTelefone('5511911110004');
  assert.equal(c.modo, 'equipe');
  const antes = chamadasIA;
  await msg('5511911110004', 'oi Júlia');
  await esperar();
  assert.equal(chamadasIA, antes);
  // o eco das mensagens do próprio agente não pausa
  roteiro.push({ mensagens: ['Olá'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  await msg('5511911110005', 'oi');
  await esperar();
  await motor.receberWebhook({ event: 'message.sent', data: { key: { id: enviados.at(-1) && `out-${enviados.length}`, remoteJid: '5511911110005@s.whatsapp.net', fromMe: true }, type: 'TEXT', content: 'Olá' } });
  assert.equal(memoria.conversaPorTelefone('5511911110005').modo, 'agente');
  // devolver ao agente
  motor.devolverAoAgente(c.id);
  assert.equal(memoria.conversaPorId(c.id).modo, 'agente');
});

teste('opt-out por palavra-chave não chama o Claude', async () => {
  roteiro.push({ mensagens: ['Oi'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  await msg('5511911110006', 'oi');
  await esperar();
  const antes = chamadasIA;
  await msg('5511911110006', 'Parar');
  await esperar();
  assert.equal(chamadasIA, antes);
  assert.equal(memoria.conversaPorTelefone('5511911110006').optout, 1);
  assert.match(paraLead('5511911110006').at(-1), /não vou mais te enviar/);
});

teste('erro no Claude: mensagem de contingência, equipe avisada, nota no CRM', async () => {
  const avisosAntes = enviados.filter((e) => e.jid === `${EQUIPE}@s.whatsapp.net`).length;
  roteiro.push(new Error('Claude Code: limite de uso atingido'));
  await msg('5511911110007', 'oi, quero crédito');
  await esperar();
  assert.match(paraLead('5511911110007')[0], /Tive um problema/);
  assert.equal(memoria.conversaPorTelefone('5511911110007').modo, 'equipe');
  assert.equal(enviados.filter((e) => e.jid === `${EQUIPE}@s.whatsapp.net`).length, avisosAntes + 1);
  const lead = crmDb.leads.find((l) => l.telefone === '5511911110007');
  assert.ok(crmDb.notas.some((n) => n.lead === lead.id && /limite de uso/.test(n.texto)));
});

teste('CRM fora do ar: agente responde mesmo assim e reenvia depois', async () => {
  crmDb.fora = true;
  roteiro.push({ mensagens: ['Oi! Como posso ajudar?'], etapa: 'em_qualificacao', acao: 'responder', resumo: 'Contato com CRM fora.', dados: { nome: 'Pedro' } });
  await msg('5511911110008', 'oi');
  await esperar();
  assert.deepEqual(paraLead('5511911110008'), ['Oi! Como posso ajudar?']);
  let c = memoria.conversaPorTelefone('5511911110008');
  assert.equal(c.crm_pendente, 1);
  assert.equal(c.crm_id, null);
  crmDb.fora = false;
  await motor.reenviarPendentesCrm();
  c = memoria.conversaPorTelefone('5511911110008');
  assert.equal(c.crm_pendente, 0);
  const lead = crmDb.leads.find((l) => l.telefone === '5511911110008');
  assert.equal(lead.etapa, 'Em qualificação');
  assert.equal(lead.nome, 'Pedro');
});

teste('ignora grupos e números da equipe; etapa inválida da IA é descartada', async () => {
  const antes = chamadasIA;
  await msg('120363000000@g.us', 'oi grupo', { isGroup: true, chatType: 'GROUP', from: '120363000000@g.us' });
  await msg(EQUIPE, 'oi, sou da equipe');
  await esperar();
  assert.equal(chamadasIA, antes);
  roteiro.push({ mensagens: ['Oi'], etapa: 'etapa_que_nao_existe', acao: 'responder', resumo: 'x' });
  await msg('5511911110009', 'oi');
  await esperar();
  assert.equal(memoria.conversaPorTelefone('5511911110009').etapa, 'novo');
});

teste('reentrega do mesmo webhook não duplica', async () => {
  roteiro.push({ mensagens: ['Oi'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  const d = { key: { id: 'repetida-1', remoteJid: '5511911110010@s.whatsapp.net' }, from: '5511911110010@s.whatsapp.net', type: 'TEXT', content: 'oi', chatType: 'PERSONAL' };
  await motor.receberWebhook({ event: 'message.received', data: d });
  await motor.receberWebhook({ event: 'message.received', data: d });
  await esperar();
  assert.equal(paraLead('5511911110010').length, 1);
});

teste('lacuna: registra uma vez por conversa e vai numa nota só', async () => {
  const notasAntes = crmDb.notas.length;
  roteiro.push({ mensagens: ['Vou confirmar com a equipe.'], etapa: 'em_qualificacao', acao: 'responder', resumo: 'x', lacuna: 'A empresa faz financiamento de carro?', nota_crm: 'Perguntou de carro.' });
  await msg('5511911110012', 'vocês fazem financiamento de carro?');
  await esperar();
  roteiro.push({ mensagens: ['Ainda não tenho essa resposta.'], etapa: 'em_qualificacao', acao: 'responder', resumo: 'x', lacuna: 'Lead perguntou se a empresa faz financiamento de carro' });
  await msg('5511911110012', 'e financiamento de carro, faz?');
  await esperar();
  const c = memoria.conversaPorTelefone('5511911110012');
  assert.equal(memoria.lacunasDaConversa(c.id).length, 1);
  const novas = crmDb.notas.slice(notasAntes);
  assert.equal(novas.length, 1, 'primeira resposta gera uma nota só; a segunda nenhuma');
  assert.match(novas[0].texto, /Etapa: .*\nPerguntou de carro\.\nPergunta sem resposta/);
});

teste('CRM lento não gera lead duplicado', async () => {
  const original = crm.criar.bind(crm);
  crm.criar = async (l) => { await dormir(400); return original(l); };
  roteiro.push({ mensagens: ['Oi'], etapa: 'novo', acao: 'responder', resumo: 'x' });
  await msg('5511911110011', 'oi');
  await dormir(1200);
  crm.criar = original;
  assert.equal(crmDb.leads.filter((l) => l.telefone === '5511911110011').length, 1);
  assert.deepEqual(paraLead('5511911110011'), ['Oi']);
});

teste('adaptador Supabase: busca, cria, atualiza', async () => {
  const sb = await criarCrm({ modo: 'supabase', formato_telefone: 'e164', supabase: { url: CRM_URL, chave: 'token-teste', tabela: 'contatos', colunas: { id: 'uid', telefone: 'fone', nome: 'nome_completo', etapa: 'status', resumo: 'obs', origem: 'canal' }, valor_origem: 'WhatsApp' } }, raiz);
  assert.equal(await sb.buscarPorTelefone('5511911110099'), null);
  const id = await sb.criar({ telefone: '5511911110099', nome: 'Ana', etapa_crm: 'Novo', campos: { renda: '3000' }, resumo: 'r' });
  assert.equal(await sb.buscarPorTelefone('5511911110099'), id);
  await sb.atualizar(id, { nome: 'Ana Lima', etapa_crm: 'Qualificado', campos: { renda: '3500' }, resumo: 'r2' });
  const l = crmDb.leads.find((x) => x.uid === id);
  assert.deepEqual([l.fone, l.nome_completo, l.status, l.renda, l.obs, l.canal], ['+5511911110099', 'Ana Lima', 'Qualificado', '3500', 'r2', 'WhatsApp']);
});

teste('modelos do CRM e prompt', async () => {
  assert.deepEqual(preencherModelo({ a: '{x}', b: 'id {x}', c: '{vazio}', $campos: true }, { x: 5, campos: { k: 'v' } }), { a: 5, b: 'id 5', k: 'v' });
  assert.equal(pegar({ data: [{ id: 3 }] }, 'data.0.id'), 3);
  const cfg = new Config(raiz);
  const agente = cfg.agente();
  const etapas = cfg.etapas();
  const sis = montarSistema({ agente, etapas, conhecimento: cfg.conhecimento() });
  assert.match(sis, /Nunca peça senha/);
  assert.match(sis, /Prime Brv/);
  const esq = esquemaSaida({ agente, etapas });
  assert.deepEqual(esq.properties.etapa.enum, etapas.etapas.map((e) => e.id));
  assert.ok(esq.properties.dados.properties.interesse);
  const ped = montarPedido({ conversa: { etapa: 'novo', dados: {}, nome_whatsapp: 'X' }, historico: [{ direcao: 'in', texto: 'oi' }], etapas, contexto: { agora: 'agora', dentroHorario: false, mensagemForaHorario: 'volta amanhã' } });
  assert.match(ped, /\[LEAD\] oi/);
  assert.match(ped, /FORA do horário/);
});

// ================= execução =================
let falhas = 0;
for (const t of testes) {
  try { await t.fn(); console.log(`✓ ${t.nome}`); } catch (e) { falhas++; console.log(`✗ ${t.nome}\n  ${e.message}`); }
}
servidorCrm.close();
memoria.db.close();
fs.rmSync(raiz, { recursive: true, force: true });
console.log(`\n${testes.length - falhas}/${testes.length} testes passaram`);
process.exit(falhas ? 1 : 0);
