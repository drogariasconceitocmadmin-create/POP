# P0 - Round-Trip Persistência

## Projeto
Portal de POPs

## Objetivo
Preservar standards auditáveis da Fase 4 no fluxo gerar, salvar, reabrir, editar, salvar e visualizar.

## Regras
- `conteudoJson.itens_avaliaveis` não pode ser apagado pelo save.
- Campos Fase 4 sem input visual devem ser preservados.
- Array bom não vira string corrida.
- String justificada não vira lista vazia.

## Arquivos Permitidos
- `Index.html`
- `apps-script/Index.html`

## Testes Esperados
- `fase4SelfTestRoundTripStandardsViewer_()`
- `fase4SelfTestRoundTripStandardsPersistencia_()`
