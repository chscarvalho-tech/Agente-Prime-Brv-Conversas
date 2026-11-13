#!/usr/bin/env node
// Linha de comando do agente. Rode "node cli.js" para ver os comandos.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { carregarEnv, criarApp } from './lib/app.js';
import { testarClaude, localizarClaude } from './lib/cerebro.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));

const AJUDA = `Comandos:
  node cli.js iniciar-env                 cria o .env a partir do .env.example (com segredo do webhook)
  node cli.js validar                     confere config/, conhecimento/ e .env
  node cli.js testar-claude               confere se o Claude Code desta máquina responde (login da assinatura)
  node cli.js testar-crm                  cria, atualiza e anota um lead de TESTE no CRM
  node cli.js testar-whatsapp             mostra o status da sessão no WA-AKG
  node cli.js registrar-webhook           cadastra o webhook deste agente no WA-AKG (usa PUBLIC_URL)
  node cli.js testar "<mensagem>" [conv]  conversa simulada (nada sai no WhatsApp). --crm grava no CRM também
  node cli.js conversa [conv]             mostra a conversa simulada
  node cli.js reset-teste [conv]          apaga a conversa simulada
  node cli.js status                      números de hoje, erros e perguntas sem resposta
  node cli.js lacunas                     perguntas que a base de conhecimento não cobriu
  node cli.js devolver <telefone>         devolve ao agente uma conversa que estava com a equipe`;

if (!cmd || cmd === 'ajuda' || cmd === '--help') { console.log(AJUDA); process.exit(0); }

if (cmd === 'iniciar-env') {
  const destino = path.join(raiz, '.env');
  if (fs.existsSync(destino)) { console.log('.env já existe; nada foi alterado.'); process.exit(0); }
  const modelo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  fs.writeFileSync(destino, modelo.replace(/^WEBHOOK_SECRET=.*$/m, `WEBHOOK_SECRET=${crypto.randomBytes(24).toString('hex')}`));
  console.log('.env criado com WEBHOOK_SECRET aleatório. Preencha o resto durante a instalação.');
  process.exit(0);
}

carregarEnv(raiz);
const app = await criarApp({ raiz, crmEmSimulacao: flags.has('--crm') });
const { config, memoria, motor, wa, crm } = app;
const ok = (s) => console.log(`✓ ${s}`);
const falha = (s) => { console.error(`✗ ${s}`); process.exitCode = 1; };

async function main() {
  switch (cmd) {
    case 'validar': {
      const { erros, avisos } = config.validar();
      for (const a of avisos) console.log(`! ${a}`);
      for (const e of erros) falha(e);
      if (!localizarClaude()) falha('Claude Code não encontrado nesta máquina (instale e faça login, ou informe CLAUDE_BIN)');
      if (!process.exitCode) ok(`configuração válida (${avisos.length} aviso(s))`);
      break;
    }

    case 'testar-claude': {
      console.log(`Executável: ${localizarClaude() ?? '(não encontrado)'}`);
      const r = await testarClaude({ raiz, agente: config.agente() });
      r.ok ? ok(`Claude Code respondeu em ${(r.duracao_ms / 1000).toFixed(1)} s (modelo ${r.modelo})`) : falha('Claude Code respondeu fora do esperado');
      break;
    }

    case 'testar-crm': {
      const tel = '5500900000000';
      console.log(`Modo do CRM: ${config.crm().modo}. Telefone de teste: ${tel}`);
      const existente = await crm.buscarPorTelefone(tel);
      ok(`busca por telefone funcionou (${existente ? `já existe: ${existente}` : 'não encontrado'})`);
      const etapas = config.etapas();
      const inicial = etapas.etapas.find((e) => e.id === etapas.etapa_inicial);
      const lead = { telefone: tel, nome: 'TESTE Agente WhatsApp (pode apagar)', etapa: inicial.id, etapa_crm: inicial.valor_crm, campos: {}, dados: {}, resumo: 'Lead de teste criado pelo agente.', origem: 'WhatsApp' };
      const id = existente ?? await crm.criar(lead);
      if (!existente) ok(`lead de teste criado: id ${id}`);
      const segunda = etapas.etapas.find((e) => e.id !== inicial.id && !e.final) ?? inicial;
      await crm.atualizar(id, { ...lead, etapa: segunda.id, etapa_crm: segunda.valor_crm, resumo: 'Lead de teste atualizado pelo agente.' });
      ok(`lead atualizado para a etapa "${segunda.valor_crm}"`);
      await crm.registrarNota(id, 'Nota de teste do agente de WhatsApp.');
      ok('nota registrada (se o CRM tiver notas)');
      const achado = await crm.buscarPorTelefone(tel);
      achado === String(id) ? ok('busca encontra o lead criado') : falha(`busca não encontrou o lead criado (achou ${achado})`);
      console.log('Confira no CRM e apague o lead de teste.');
      break;
    }

    case 'testar-whatsapp': {
      if (!wa.configurado) return falha('WA-AKG não configurado no .env (WAAKG_URL, WAAKG_API_KEY, WAAKG_SESSION)');
      const s = await wa.status();
      console.log(JSON.stringify(s?.data ?? s, null, 2));
      break;
    }

    case 'registrar-webhook': {
      const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
      if (!base) return falha('Defina PUBLIC_URL no .env (endereço https pelo qual o WA-AKG alcança este agente)');
      const url = `${base}/webhook`;
      const lista = await wa.listarWebhooks();
      const itens = lista?.data ?? lista ?? [];
      if ((Array.isArray(itens) ? itens : []).some((w) => w.url === url)) return ok(`webhook já cadastrado: ${url}`);
      await wa.registrarWebhook({ url, secret: process.env.WEBHOOK_SECRET || undefined });
      ok(`webhook cadastrado: ${url}`);
      break;
    }

    case 'testar': {
      const texto = pos[0];
      if (!texto) return falha('uso: node cli.js testar "<mensagem>" [conversa]');
      const jid = `sim:${pos[1] || 'teste'}`;
      const conversa = motor.mensagemRecebida({ from: jid, pushName: 'Teste', content: texto, type: 'TEXT', key: { id: `sim-${Date.now()}` } });
      clearTimeout(motor.timers.get(conversa.id));
      motor.timers.delete(conversa.id);
      const ultimoIn = memoria.mensagens(conversa.id, 1)[0].id;
      const inicio = Date.now();
      await motor.processar(conversa.id);
      const c = memoria.conversaPorId(conversa.id);
      const resp = memoria.mensagens(c.id, 20).filter((m) => m.direcao === 'out' && m.id > ultimoIn);
      console.log(`\n${resp.map((m) => `🤖 ${m.texto}`).join('\n') || '(sem resposta)'}\n`);
      console.log(`etapa: ${c.etapa} · modo: ${c.modo} · dados: ${JSON.stringify(c.dados)} · ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
      if (c.resumo) console.log(`resumo: ${c.resumo}`);
      const ev = memoria.eventos(c.id, 5).filter((e) => e.criado_em >= inicio).map((e) => `${e.tipo} ${JSON.stringify(e.detalhe)}`);
      if (ev.length) console.log(`eventos: ${ev.join(' | ')}`);
      break;
    }

    case 'conversa': {
      const c = memoria.conversaPorJid(`sim:${pos[0] || 'teste'}`);
      if (!c) return falha('conversa não encontrada');
      for (const m of memoria.mensagens(c.id, 200)) console.log(`${m.direcao === 'in' ? '👤' : '🤖'} ${m.texto}`);
      console.log(`\netapa: ${c.etapa} · dados: ${JSON.stringify(c.dados)}`);
      break;
    }

    case 'reset-teste': {
      memoria.apagarConversa(`sim:${pos[0] || 'teste'}`);
      ok('conversa simulada apagada');
      break;
    }

    case 'status': {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const r = memoria.resumoGeral(hoje.getTime());
      console.log(`Hoje: ${r.conversas} conversa(s) nova(s), ${r.respostas_ia} resposta(s) do Claude, ${r.erros_ia} erro(s) do Claude, ${r.erros_crm} erro(s) de CRM, ${r.lacunas} pergunta(s) sem resposta.`);
      console.log(`Com a equipe agora: ${r.com_equipe} · aguardando reenvio ao CRM: ${r.crm_pendente}`);
      for (const e of r.por_etapa) console.log(`  ${e.etapa}: ${e.n}`);
      break;
    }

    case 'lacunas': {
      const l = memoria.lacunas(50);
      if (!l.length) return ok('nenhuma pergunta sem resposta');
      for (const x of l) console.log(`${new Date(x.criado_em).toLocaleString('pt-BR')} — ${x.pergunta}`);
      break;
    }

    case 'devolver': {
      const c = memoria.conversaPorTelefone(pos[0] || '');
      if (!c) return falha('conversa não encontrada para esse telefone');
      motor.devolverAoAgente(c.id);
      ok(`conversa com +${c.telefone} devolvida ao agente`);
      break;
    }

    default:
      console.log(AJUDA);
      process.exitCode = 1;
  }
}

try { await main(); } catch (e) { falha(e.message); } finally { memoria.db.close(); }
