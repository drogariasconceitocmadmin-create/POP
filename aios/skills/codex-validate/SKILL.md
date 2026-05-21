# Skill: Codex Validate

Use esta skill para validação independente por Codex.

## Escopo
- Codex valida a branch e escreve relatório em `/reports`.
- Sem deploy: nível Alto.
- Com deploy: nível Altíssimo.

## Obrigatório
- Confirmar projeto.
- Confirmar pasta.
- Confirmar scriptId.
- Confirmar deploymentId.
- Salvar `/reports/validacao-atual.md`.
- Salvar `/reports/validacao-atual.json`.

## Segurança
- Não fazer deploy sem autorização explícita.
- Não misturar POP e Handover.
- Se houver divergência de scriptId ou deploymentId, parar.
