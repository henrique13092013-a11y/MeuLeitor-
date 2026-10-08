# MeuLeitor

Leitor web para PDFs acadêmicos digitalizados, pensado principalmente para celular.

## Como funciona
- O PDF é aberto e processado no próprio navegador; não é enviado ao GitHub.
- Rotação manual vale da folha atual em diante, até uma nova rotação.
- Divisão manual vale da folha atual em diante, até o usuário interrompê-la.
- A posição de leitura, giros, divisões e preferências ficam salvos localmente por documento.
- A numeração de leitura considera as metades criadas pela divisão e mantém também a referência à folha original.
- É possível ajustar corte, lombada, margens, ordem de leitura, zoom e tema.
- O PDF final é gerado no aparelho com as regras salvas.

## Interface
A tela de leitura mantém apenas os comandos essenciais visíveis. Giro, zoom, recorte, tema e exportação ficam concentrados em **Ajustes**. O painel permanece aberto até ser fechado explicitamente.

## Estrutura
- `index.html`: interface.
- `styles.css`: estilos responsivos.
- `app.js`: leitura, navegação, renderização e exportação.
- `state.mjs`: regras puras de intervalo para giro/divisão e contagem de leitura.
- `tests/state.test.mjs`: testes de regressão do estado.
- `sw.js`: cache da aplicação.

## Testes
Execute com Node 22+:

```bash
node --test tests/state.test.mjs
```

Os testes cobrem propagação de rotação, propagação/interrupção da divisão, contagem após divisão, migração das configurações antigas e compactação de regras redundantes.

## Observação
PDF.js e pdf-lib são carregados por CDN, portanto a primeira abertura exige internet. Os arquivos locais da aplicação ficam em cache pelo service worker.
