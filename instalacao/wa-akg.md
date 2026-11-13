# Conectar o agente ao WA-AKG

A empresa já tem o WA-AKG instalado e o número conectado. O agente só precisa de acesso à API e de um webhook.

## 1. Dados do WA-AKG (`.env`)

Peça à dona, ou abra o painel do WA-AKG com ela:

- `WAAKG_URL`: endereço do WA-AKG, sem `/api` (ex.: `http://localhost:3000` ou `https://wa.dominio.com.br`).
- `WAAKG_API_KEY`: Settings → API Keys → gerar chave (`wag_...`). Fica só no `.env`; não repita na conversa.
- `WAAKG_SESSION`: o nome da sessão do número que vai atender (aparece na lista de sessões).

Confira com `node cli.js testar-whatsapp` (deve mostrar a sessão como conectada).

## 2. Desligar respostas automáticas do próprio WA-AKG

Na sessão, **desative auto-reply e deixe a mensagem de boas-vindas vazia**. Se o WA-AKG responder sozinho, o agente entende que alguém da equipe respondeu e para de atender aquele lead.

Se o CRM dela também tiver alguma automação que responde pelo mesmo número, desligue para os leads novos (ou combine qual dos dois responde).

## 3. Endereço público do agente (`PUBLIC_URL`)

O WA-AKG avisa o agente a cada mensagem por um webhook, e **recusa endereços http e localhost**. O agente precisa de um endereço https:

- **Túnel do Cloudflare (mais simples, sem domínio):**
  ```bash
  cloudflared tunnel --url http://localhost:3200
  ```
  Copie o endereço `https://....trycloudflare.com` para `PUBLIC_URL`. Atenção: esse endereço muda quando o túnel reinicia; aí é preciso trocar o `PUBLIC_URL` e rodar `node cli.js registrar-webhook` de novo. Para algo fixo, use um túnel nomeado do Cloudflare com domínio próprio.
- **Domínio próprio com proxy reverso (Nginx/Caddy)** apontando para a porta 3200, se o agente rodar num servidor.

## 4. Cadastrar o webhook

```bash
node cli.js registrar-webhook
```

Ele cadastra `PUBLIC_URL/webhook` na sessão, para os eventos `message.received` e `message.sent`, com o `WEBHOOK_SECRET` do `.env`. Se já existir, não duplica.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Lead manda mensagem e nada acontece | agente desligado (`npm start`), túnel caiu ou `PUBLIC_URL` mudou (rode `registrar-webhook` de novo), conversa com a equipe (`node cli.js devolver <telefone>`) |
| 401 no `/webhook` | segredo diferente do cadastrado: apague o webhook no WA-AKG e rode `registrar-webhook` |
| Agente para de responder logo depois da primeira resposta | auto-reply ou boas-vindas do WA-AKG ligados, ou outra automação respondendo pelo mesmo número |
| Duas respostas por mensagem | dois webhooks para o mesmo endereço |
| Áudio sem resposta útil | o agente pede para a pessoa escrever (transcrição não implementada) |
| Sessão cai | normal no WA-AKG de vez em quando: reconecte pelo QR no painel dele |

**Risco do WA-AKG:** ele usa o WhatsApp Web e não é oficial. O WhatsApp pode bloquear o número, principalmente com envio em massa. O agente só responde quem escreveu, o que é o uso de menor risco.
