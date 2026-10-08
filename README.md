# Leitor Acadêmico

Leitor web para PDFs acadêmicos digitalizados, pensado para celular e tablet.

## Recursos
- Abre PDFs diretamente do aparelho, sem upload.
- Rotação em passos de 90°.
- Divisão opcional de páginas duplas (livro aberto) em duas páginas sequenciais.
- Corte ajustável entre 40% e 60% para scans desalinhados.
- Remoção ajustável da lombada/gutter.
- Corte uniforme de margens externas.
- Ajuste à largura, zoom, modo claro/escuro.
- Navegação por botões, teclado e gesto horizontal.
- Salva localmente a última página e as preferências.
- Instalável como PWA quando hospedado em HTTPS.

## GitHub Pages
1. Em Settings → Pages, selecione `Deploy from a branch`.
2. Escolha a branch `main` e a pasta `/ (root)`.
3. Salve e abra o endereço fornecido pelo GitHub Pages.

O PDF selecionado pelo usuário não é enviado ao GitHub; ele é processado no navegador.

## Observação
O PDF.js é carregado pelo CDN cdnjs. Portanto, a primeira abertura exige internet. Os arquivos do aplicativo ficam em cache após a instalação.
