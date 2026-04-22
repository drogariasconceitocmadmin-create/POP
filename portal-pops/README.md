# Portal POPs (publicação no Google)

Este diretório mantém **fonte local versionável** (JSON/Markdown/CSV) e um **publicador** que cria/atualiza no Google Drive arquivos **nativos** (Docs/Sheets) e a estrutura de pastas.

## Estrutura
- `data/`: dados do portal (perfis/permissões/config/pops)
- `templates/`: templates markdown/html (quando aplicável)
- `scripts/`: publicador e integrações Google
- `config/`: configurações e credenciais (não versionar credenciais)
- `logs/`: logs de publicação

## 1) Preparar credenciais no Google Cloud
1. Acesse Google Cloud Console e crie/seleciona um projeto.
2. Habilite APIs:
   - Google Drive API
   - Google Docs API
   - Google Sheets API
3. Crie credenciais **OAuth Client ID** (Desktop App).
4. Baixe o JSON e salve como:
   - `config/oauth-client.json`

## 2) Instalar dependências
```bash
cd portal-pops
npm install
```

## 3) Autenticar (gera token local)
```bash
npm run auth
```

Ele abrirá o navegador para login. Ao final, grava `config/token.json`.

## 4) Publicar no Drive (cria/atualiza)
```bash
npm run publish
```

## Rodar sem efetivar (dry-run)
```bash
npm run publish:dry
```

## Observações de segurança
- Nunca compartilhe `config/token.json`.
- Se quiser revogar: na sua conta Google → Segurança → Acesso de terceiros → remova o app.

