# Portal de POPs — Drogarias Conceito

## Objetivo

Sistema interno para biblioteca de POPs, fluxo de aprovação/versionamento, leituras e indicadores operacionais (performance), com backend em **Google Apps Script** e interface em **HTML** servida pela Web App.

## Estrutura principal do repositório

| Pasta / área | Função |
|--------------|--------|
| Raiz (`Index.html`, `Código.gs`) | Fonte principal do portal ligada ao projeto Apps Script (Web App). |
| `apps-script/` | Cópia/espelho para deploy com **clasp** (`Index.html`, `Código.js`, `appsscript.json`). |
| `apps-script.backup-online-*/` | Backup pontual de referência; não usar como fonte única de verdade. |
| `Portal POPs Drogarias Conceito/` | Documentação de negócio, fluxos e prompts de apoio. |
| `portal-pops/` | Scripts Node auxiliares (Drive/Docs/Sheets, etc.) — opcional face ao Apps Script. |

## Arquivos principais

- **`Código.gs`** — sessão, permissões, APIs, POPs, IA (geração), performance, auditoria.
- **`Index.html`** — UI do portal (login, biblioteca, gestão de POPs, performance, leituras).
- **`apps-script/appsscript.json`** — manifesto do projeto Apps Script.
- **`apps-script/Código.js`** — mesmo papel que `Código.gs` no fluxo clasp (manter alinhado ao publicar).

## Como publicar / atualizar no Apps Script

1. Alterar **`Código.gs`** e/ou **`Index.html`** na raiz (ou espelhar em `apps-script/` conforme o teu fluxo).
2. Com **clasp** (recomendado): na pasta `apps-script/`, `clasp push` após garantir que `Código.js` e `Index.html` estão atualizados e alinhados com a raiz, se usares essa cópia.
3. No **Google Apps Script**: **Implementar** → **Nova implementação** (ou atualizar implementação existente) da **Web app** — executar como autor, acesso conforme política da organização.
4. Abrir a **URL da Web App** e validar login, biblioteca e um fluxo crítico (ex.: abrir POP, salvar rascunho).

Sem rede ou clasp configurado, podes colar/copiar manualmente para o editor do projeto — evita divergência entre raiz e `apps-script/`.

## Branch principal de produção

**`main`** — é a branch que deve refletir o estado aceite para produção / alinhamento com o que está publicado na Web App.

## Regras de segurança na manutenção

- **Arquitetura:** não reestruturar pastas, APIs ou fluxos sem necessidade clara e acordo; mudanças grandes aumentam risco de regressão na Web App.
- **QA / validações:** não afrouxar regras de qualidade ou de permissão sem evidência (ticket, auditoria, decisão registada); “passar mais rápido” não é critério.
- **Validação real:** sempre testar na **Web App publicada** (URL de produção ou de teste acordada) antes de considerar alteração pronta; o editor local ou só `clasp` não substituem o teste no browser com sessão real.

---

*Repositório: uso interno Drogarias Conceito. Credenciais, IDs de planilha e chaves API não devem ser commitadas em texto claro.*
