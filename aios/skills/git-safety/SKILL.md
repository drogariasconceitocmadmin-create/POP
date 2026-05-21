# Skill: Git Safety

Use esta skill antes de editar, commitar, pushar ou publicar.

## Preflight Obrigatório
- Rodar `pwd`.
- Rodar `git branch --show-current`.
- Rodar `git status --short`.
- Rodar `git diff --stat`.

## Bloqueios
- `git add .` é proibido.
- Diff acima de 1500 linhas exige parar e pedir autorização.
- Deleção de arquivo tracked crítico exige parar.
- Arquivo novo `apps-script/Code.gs` exige parar.
- Handover e POP no mesmo commit exige parar.

## Conduta
- Adicionar arquivos explicitamente.
- Não reverter alterações que não foram feitas por você.
- Não mexer na `main` sem autorização explícita.
