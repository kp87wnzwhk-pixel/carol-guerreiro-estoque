# Carol Guerreiro Importado — Estoque

App **estático** (mobile-first) para controle de caixas no armazém.

**Slogan:** *No Brasil é luxo, com a Carol é barato.*

- 32 prateleiras × 20 slots (640 posições)
- Corredores: A 1–8 · B 9–16 · C 17–24 · D 25–32
- Sem login — dados no aparelho (`localStorage` + fotos no IndexedDB)
- Cadastro por foto com OCR (Tesseract.js via CDN)
- Backup JSON, importação, CSV e restauração de auto-backups

## Abrir localmente

Como o app usa módulos ES (`type="module"`), abra com um servidor HTTP local (não use `file://`).

### Opção rápida (Node)

```bash
npx --yes serve .
```

Depois abra o endereço mostrado no terminal (geralmente `http://localhost:3000`).

### Python

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080`.

### VS Code / Cursor

Use a extensão “Live Server” na pasta do projeto.

## Uso no celular

1. Abra o endereço local (mesma rede Wi‑Fi) ou o site no GitHub Pages.
2. No Chrome/Safari: **Adicionar à tela inicial** (PWA com `manifest.json` + service worker).
3. Os dados ficam **neste aparelho**. Faça **Backup JSON** com frequência.

## Publicar no GitHub

Repositório sugerido: `kp87wnzwhk-pixel/carol-guerreiro-estoque`

```bash
cd carol-guerreiro-estoque
git init
git add .
git commit -m "App de estoque Carol Guerreiro Importado"
git branch -M main
git remote add origin https://github.com/kp87wnzwhk-pixel/carol-guerreiro-estoque.git
git push -u origin main
```

(Crie o repositório vazio no GitHub antes, se ainda não existir.)

## GitHub Pages (opcional)

1. No repositório: **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / pasta `/ (root)`
4. Aguarde alguns minutos e abra `https://kp87wnzwhk-pixel.github.io/carol-guerreiro-estoque/`

## Estrutura

```
index.html
css/styles.css
js/app.js
js/storage.js
js/db.js
js/ocr.js
js/cdn.json
manifest.json
sw.js
icons/logo.svg
README.md
```

## Seed inicial

Uma única caixa de exemplo:

- **Graziely Ferreira** · `(21) 97180-6776` · prateleira 1 · slot 1 · via foto

## Privacidade

Telefones e fotos ficam só no navegador do usuário. Fotos são isoladas por `boxId` no IndexedDB.
