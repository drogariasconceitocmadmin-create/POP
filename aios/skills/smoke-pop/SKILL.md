# Skill: Smoke POP

Use esta skill para validar smoke manual ou automatizado do Portal de POPs.

## Antes Do Smoke
- Confirmar branch.
- Confirmar deployment testado.
- Confirmar scriptId POP.
- Confirmar requestId quando houver geração por IA.

## Checklist De POP Crítico
- `conteudoJson.itens_avaliaveis` existe e tem standards fortes.
- Não há `criterioAvaliacao` genérico como fonte principal.
- Campos operacionais não aparecem como `Não informado`.
- `materiais_epi` tem justificativa quando não aplicável.
- Viewer crítico renderiza standards como fonte principal.

## Evidências
- Registrar POP, popId, deployment, requestId e falhas observadas.
- Anexar achados em `/reports` quando solicitado.
