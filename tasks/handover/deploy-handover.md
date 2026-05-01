# Deploy - Handover

## Projeto
Handover

## Objetivo
Publicar o Web App do Handover com isolamento completo do Portal de POPs.

## Preflight
```powershell
cd Handover
pwd
git status --short
clasp deployments
```

## Regras
- Usar apenas `Handover/.clasp.json`.
- Nunca usar deploymentId do POP.
- Nunca editar arquivos do POP.
- Deploy só dentro de `Handover/`.
