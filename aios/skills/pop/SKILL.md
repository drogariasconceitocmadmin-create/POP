# Skill: Portal de POPs

Use esta skill para tarefas do Portal de POPs.

## Identidade
- scriptId POP: `1aNJwuBlFksSAM3NhU6y1Jj6zU841239n59YXxnFAL6EXY7YjTr7lL8Y8`
- deploymentId POP: `AKfycbx53geW1UL8ez37rXZ6FqxaFf7QstRIU4O8r3ngqOEfM07KVoLAJS-8X9fx2XXvRgD9`
- `.clasp.json` do POP fica na raiz do repositório.

## Regras De Qualidade
- POP crítico novo deve persistir `conteudoJson.itens_avaliaveis` com standards auditáveis fortes.
- Não permitir `criterioAvaliacao` genérico.
- Não permitir campo operacional visível como `Não informado`.
- Viewer crítico deve usar standards como fonte principal.
- Foco em padrão Conceito/Forbes: clareza executiva, auditabilidade e operação de loja.

## Segurança
- Não tocar em `Handover/` em tarefas POP.
- Não usar deploymentId do Handover.
- Não fazer deploy sem autorização explícita.
