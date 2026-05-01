# P0 - Guard Crítico De Standards

## Projeto
Portal de POPs

## Objetivo
Impedir que POP crítico novo seja persistido como estrutura legada/fraca.

## Regras
- POP crítico sem standards fortes deve ser reconstruído quando houver contexto suficiente.
- POP crítico sem contexto suficiente deve ser bloqueado.
- Nunca salvar `criterioAvaliacao` genérico como válido.

## Arquivos Permitidos
- `Código.gs`
- `apps-script/Código.js`

## Testes Esperados
- `fase4SelfTestGuardCriticoSemContexto_()`
- `fase4SelfTestRoundTripStandardsPersistencia_()`
- regressões Fase 4 relevantes
