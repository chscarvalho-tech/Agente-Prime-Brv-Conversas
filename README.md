# Agente Prime Brv - Conversas

Agente de atendimento de WhatsApp para a Prime Brv. Funciona como um funcionário que usa as ferramentas que a empresa já tem:

1. O lead manda mensagem no WhatsApp; o **WA-AKG** avisa o agente.
2. O agente procura o lead no **CRM** pelo telefone e, se não existir, cria na hora.
3. O **Claude Code** da empresa lê a base de conhecimento e a conversa e escreve a resposta.
4. O agente responde pelo WA-AKG e atualiza no CRM a etapa, os dados de qualificação, o resumo e as notas.
5. Quando é a hora (lead qualificado, pedido de atendimento humano, assunto sensível), transfere: avisa a equipe no WhatsApp e para de responder aquele lead.

## Instalação

Requisitos: Node 22.13+, [Claude Code](https://docs.claude.com/claude-code) instalado e logado na conta da empresa, WA-AKG com o número conectado, CRM com acesso por API ou banco.

```bash
git clone https://github.com/chscarvalho-tech/Agente-Prime-Brv-Conversas.git
cd Agente-Prime-Brv-Conversas
claude
```

E peça: **"instalar o agente"**. O Claude Code conduz tudo pelo [CLAUDE.md](CLAUDE.md): entrevista sobre o negócio (produtos, perguntas frequentes, objeções, etapas, equipe), conexão com o CRM, testes e ligação no WhatsApp.

Não há dependências para instalar (`npm install` não é necessário).

## Sobre o uso do Claude

Cada resposta roda o Claude Code desta máquina (`claude -p`) e consome os limites da assinatura da empresa. Por isso:

- o agente precisa ficar ligado na máquina onde o Claude Code está logado;
- se o limite da assinatura acabar, o agente avisa o lead, passa a conversa para a equipe e registra no CRM;
- é possível trocar para créditos de API a qualquer momento (`claude.usar_chave_api: true` em `config/agente.json` e `ANTHROPIC_API_KEY` no `.env`).

Planos de assinatura do Claude são pensados para uso pessoal e têm limites por janela de tempo. Para volume alto ou atendimento 24 h de produção, confira os termos de uso da Anthropic e considere a chave de API.

## Estrutura

| Pasta/arquivo | O que é |
|---|---|
| `config/agente.json` | nome, tom, horário, modelo do Claude, mensagens padrão |
| `config/etapas.json` | etapas do funil (com o nome de cada uma no CRM), dados a coletar, regras de transferência, equipe |
| `config/crm.json` | como falar com o CRM (API REST, Supabase ou adaptador próprio) |
| `conhecimento/*.md` | tudo o que o agente sabe sobre a empresa |
| `instalacao/` | roteiros de instalação (entrevista, CRM, WA-AKG) |
| `cli.js` | comandos de teste e operação (`node cli.js`) |

Os dados das conversas ficam em `data/` (local, fora do GitHub). Senhas e chaves ficam no `.env` (local, fora do GitHub).
