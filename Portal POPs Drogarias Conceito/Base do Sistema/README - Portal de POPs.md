# Portal de POPs Drogarias Conceito

## Objetivo do sistema
- Centralizar a gestão de POPs (criação, revisão, aprovação, publicação e arquivamento).
- Garantir conformidade operacional por meio de leituras obrigatórias e auditoria por usuário.
- Integrar com Google Drive para armazenar PDFs oficiais, anexos, documentos relacionados e formulários.

## Stack atual
- Sistema interno em Google Apps Script + HTML.
- Banco em Google Sheets.
- Uso de Google Drive para PDFs, anexos, documentos, formulários e evidências.

## Estrutura geral
- **Backend (Apps Script)**: regras, permissões, workflow, versionamento, leitura e integração com Drive.
- **Frontend (HTML)**: portal, dashboard, viewer do POP, gestão de usuários e gestão de POPs.
- **Dados (Sheets)**: Usuários, POPs, Leituras e Sessões.
- **Arquivos (Drive)**: PDFs Oficiais, Anexos, Documentos Relacionados e Formulários.

## Perfis do sistema
- diretor
- gerente
- farmaceutico
- atendente
- entregador

## Principais regras
- Diretor aprova e publica.
- Gerente, farmaceutico, atendente e entregador podem criar e editar rascunho.
- Edição em POP vigente gera nova versão.
- Leitura crítica obrigatória pode bloquear o sistema.
- Autor deve ser o usuário logado.
- `vigenciaInicio` deve ser automática.
- `revisaoPrevista` automática.

## Próximos módulos
- Workflow completo de aprovação.
- Versionamento robusto com histórico imutável.
- Bloqueio por leitura crítica vencida.
- Upload automático por pasta no Drive.
- Dashboard de conformidade (ranking e indicadores).

