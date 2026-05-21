# Skill: pop-mirror-parity

## Domínio
Portal de POPs — Drogarias Conceito

## Propósito
Garantir paridade entre os arquivos raiz (`Código.gs`, `Index.html`) e os arquivos de deploy via clasp (`apps-script/Código.js`, `apps-script/Index.html`) antes de qualquer commit, push ou deploy.

## Pares de espelho obrigatórios

| Raiz (edição/referência) | apps-script/ (fonte do clasp) |
|---|---|
| `Código.gs` | `apps-script/Código.js` |
| `Index.html` | `apps-script/Index.html` |

## Regras

1. **Antes de commit / push / deploy**, validar que os dois pares estão alinhados.
2. **Se `apps-script/` for a fonte do deploy via clasp**, a raiz deve ser atualizada para espelhar o conteúdo antes do commit.
3. **Se a raiz for a fonte de edição**, `apps-script/` deve ser atualizado antes do deploy.
4. **Nunca commitar apenas um lado do espelho** sem justificativa explícita registrada na mensagem de commit.
5. **Antes de qualquer `clasp push`**, rodar comparação/diff entre os pares e confirmar ausência de divergência.
6. **Se houver divergência**, parar imediatamente e corrigir antes de publicar.

## Verificação pré-deploy (checklist obrigatório)

```
diff Código.gs apps-script/Código.js       → deve ser vazio
diff Index.html apps-script/Index.html     → deve ser vazio
```

Se qualquer diff retornar conteúdo: **PARAR. Corrigir. Repetir verificação.**

## Relatório mínimo exigido

Toda operação de deploy deve registrar:

| Item | Valor |
|---|---|
| `Código.gs` alinhado | SIM / NAO |
| `Index.html` alinhado | SIM / NAO |
| `apps-script/` publicado pelo clasp | SIM / NAO |

## Gatilhos de bloqueio

| Condição | Ação |
|---|---|
| Diff não vazio entre par de espelho | `SYS_BLOCK` — corrigir paridade antes de prosseguir |
| Commit com apenas um lado modificado | Exigir justificativa na mensagem ou bloquear |
| Deploy sem verificação de paridade | `SYS_BLOCK` — executar checklist primeiro |

## Histórico
- Criado após incidente de paridade: commit `89de3e6` atualizou apenas `apps-script/`; raiz (`Código.gs`, `Index.html`) ficou desatualizada até `7dda8c2`.
