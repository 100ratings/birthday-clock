# Birthday Clock

PWA para encontrar oportunidades de mágica em que a hora e os minutos formam uma data no formato dia/mês

## GitHub Pages

1. Envie esta pasta para o repositório `100ratings/birthday-clock`
2. Nas configurações de Pages, escolha a branch `main` e a pasta `/docs`
3. No iPhone, abra a URL pelo Safari e adicione à Tela de Início

## Avisos pelo Pushover

No terminal, entre na pasta `worker` e use uma conta Cloudflare autenticada pelo Wrangler

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put APP_PASSWORD
npx wrangler secret put PUSHOVER_TOKEN
npx wrangler secret put PUSHOVER_USER
```

Use uma senha exclusiva e forte para `APP_PASSWORD`, o token de um aplicativo do Pushover para `PUSHOVER_TOKEN` e sua chave de usuário para `PUSHOVER_USER`

No Birthday Clock, abra **Ajustes** e informe o endereço HTTPS do Worker e a mesma senha do app

A lista usa o fuso do aparelho. Quando você marca um aviso, o Worker guarda o horário para poder enviar ao Pushover com a PWA fechada. A entrega depende da conexão e dos ajustes de notificações do aparelho

As datas do arquivo fornecido são usadas como estão
