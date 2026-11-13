# Agente Prime Brv - Conversas

Este repositório é um **agente de atendimento de WhatsApp**. Ele trabalha como um funcionário que usa duas ferramentas que a empresa já tem:

- **WA-AKG**: recebe e envia as mensagens do WhatsApp;
- **CRM da empresa**: onde o agente cria cada lead e atualiza a etapa e os dados de qualificação.

O "cérebro" é o **Claude Code desta máquina**: cada resposta roda `claude -p` com o login da empresa e consome os limites da assinatura dela. Não há chave de API, a não ser que ela escolha usar (`claude.usar_chave_api`).

```
Lead ─► WA-AKG ─webhook─► agente (server.js) ─► CRM: busca/cria o lead
                                │
                                ├─► Claude Code (claude -p): lê a base de conhecimento + conversa, devolve resposta e qualificação
                                ├─► WA-AKG: envia a resposta
                                └─► CRM: atualiza etapa, dados, resumo e notas; transfere e avisa a equipe no WhatsApp
```

Quem fala com você aqui é a dona do negócio ou alguém da equipe dela, não um programador. Fale em português simples, explique o porquê de cada passo e peça uma coisa de cada vez.

## Quando pedirem "instalar o agente" (ou na primeira vez que abrirem o repositório)

Siga em ordem e diga em que passo está. Grave o progresso em `data/instalacao.md` (o que foi feito e o que ficou pendente), para retomar se a sessão cair.

1. **Requisitos.** `node --version` precisa ser 22.13 ou maior (senão, peça para instalar o Node LTS em nodejs.org). Confira que o Claude Code está logado na conta da empresa: `node cli.js testar-claude` tem que dar ✓.
2. **Criar o `.env`:** `node cli.js iniciar-env`.
3. **Entrevista do negócio.** Siga `instalacao/entrevista.md` do começo ao fim: peça todo o material que existir, pergunte o que faltar, sugira perguntas frequentes e objeções do segmento, proponha ações e grave tudo em `conhecimento/*.md` e `config/*.json`. É a parte mais importante: o agente só sabe o que estiver ali.
4. **Conectar o CRM.** Siga `instalacao/conectar-crm.md`. Termina com `node cli.js testar-crm` ✓ e a dona confirmando o lead de teste no CRM.
5. **Testar as conversas** (seção abaixo). Mostre trechos e ajuste até ela aprovar.
6. **Conectar o WA-AKG.** Siga `instalacao/wa-akg.md`: `.env`, desligar auto-reply, `PUBLIC_URL` https, `node cli.js registrar-webhook`.
7. **Ligar.** `npm start` (ou pm2, seção "Deixar rodando"). Peça para ela mandar uma mensagem de outro celular para o número e confirme: resposta no WhatsApp, lead no CRM, etapa mudando.
8. `node cli.js validar` sem erros. Resuma o que ficou configurado e as pendências.

Segredos (chave do WA-AKG, chave do CRM, chave de API) vão só para o `.env`. Nunca os repita na conversa, nunca os grave em outro arquivo e nunca faça commit do `.env`.

## Testar antes de ligar

Nada sai no WhatsApp. Cada teste consome um pouco do limite do Claude Code.

```bash
node cli.js testar "oi, vi o anúncio de vocês" t1
node cli.js testar "quanto vocês cobram?" t1
node cli.js conversa t1
node cli.js reset-teste t1
```

Rode pelo menos estas situações (uma conversa para cada, com 3 a 6 mensagens):

1. lead ideal, que chega a qualificado e é transferido;
2. curioso sem perfil, que é desqualificado com educação;
3. pergunta fora da base, que vira lacuna sem resposta inventada (`node cli.js lacunas`);
4. "quero falar com uma pessoa", que transfere;
5. pedido de senha, PIX ou "taxa para liberar", que o agente recusa e orienta sobre golpe;
6. "parar", que sai da lista.

Use `--crm` em um dos testes para ver o lead aparecer no CRM.

## Deixar rodando

O agente precisa ficar ligado **nesta máquina**, porque é nela que o Claude Code está logado. O computador não pode dormir.

```bash
npm i -g pm2
pm2 start server.js --name agente-prime-brv
pm2 save
pm2 logs agente-prime-brv
```

No Windows, para subir junto com o computador use `npm i -g pm2-windows-startup && pm2-startup install`. O túnel do Cloudflare (se usado) também precisa ficar rodando.

## Operação do dia a dia

| Pedido | O que fazer |
|---|---|
| "Como está o agente hoje?" | `node cli.js status` |
| "O que ele não soube responder?" | `node cli.js lacunas`, pergunte a resposta à dona e acrescente em `conhecimento/03-perguntas-frequentes.md` |
| "Muda o jeito de falar / uma regra / uma etapa" | edite `config/agente.json`, `config/etapas.json` ou `conhecimento/`; rode `node cli.js validar` e um `testar`. Não precisa reiniciar: a configuração é lida a cada mensagem (só `crm.json` e `.env` pedem reinício) |
| "A equipe terminou com o cliente, o agente pode voltar" | `node cli.js devolver <telefone>` |
| "Pausar o agente" | `"ativo": false` em `config/agente.json` |
| Erro de Claude em `status` | rode `node cli.js testar-claude`. Se for limite da assinatura, o agente já mandou a mensagem de contingência e passou para a equipe. Opções: esperar o limite renovar, usar modelo mais leve (`claude.modelo: "haiku"`), ou usar chave de API (`claude.usar_chave_api: true` + `ANTHROPIC_API_KEY`) |
| Erro de CRM em `status` | `node cli.js testar-crm`. O agente continua respondendo e reenvia ao CRM a cada 5 minutos |

## Mapa do código

- `server.js`: recebe os webhooks do WA-AKG.
- `lib/motor.js`: o fluxo (agrupar mensagens, opt-out, CRM, Claude, envio, transferência, pausa quando a equipe responde).
- `lib/cerebro.js`: monta o prompt e roda `claude -p` sem ferramentas, com saída em JSON validada por esquema.
- `lib/crm.js`: conector do CRM (modos http, supabase, modulo, nenhum).
- `lib/waakg.js`: cliente da API do WA-AKG.
- `lib/memoria.js`: SQLite local em `data/` com o histórico das conversas e o vínculo número ↔ lead no CRM.
- `testes/rodar.mjs`: testes automáticos sem Claude, sem WhatsApp e com um CRM falso (`npm run testes`).

Mudou código? Rode `npm run testes` antes de terminar.
