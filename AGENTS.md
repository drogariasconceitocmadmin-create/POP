# AGENTS.md - Portal de POPs

## Projeto Principal
- O projeto principal deste repositório é o Portal de POPs.
- Cursor não faz deploy.
- Codex só faz deploy quando houver autorização explícita.
- Se houver dúvida de projeto, pasta, scriptId ou deploymentId, parar e reportar.

## Segurança Git
- Não usar `git add .`.
- Não misturar POP e Handover no mesmo commit.
- Antes de editar, rodar:
  - `pwd`
  - `git branch --show-current`
  - `git status --short`
- Bloquear diff acima de 1500 linhas sem autorização explícita.

## Isolamento POP x Handover
- POP usa o `.clasp.json` da raiz.
- Handover é projeto isolado em `Handover/`.
- Não usar `.clasp.json`, URL ou deploymentId do outro projeto.

## Proteções De Arquivos
- Não deletar `apps-script/Código.js`.
- Não reduzir `apps-script/Index.html`.
- Não criar `apps-script/Code.gs`.
- Não substituir arquivos inteiros sem autorização explícita.
