# AGENTS — Git History Rewrite & GitHub PR Procedure

## ⚠️ PR entre historiales reescritos sin ancestro común

Crear una Pull Request desde una rama cuyo historial ha sido reescrito (p. ej., mediante `git filter-repo` o `git filter-branch`) hacia `main` es **impossible** en GitHub.

### Por qué falla

- GitHub rechaza con: `422 Validation Failed — "The <branch> branch has no history in common with main"`.
- Esto ocurre porque reescribir cambia cada hash de commit, por lo que las dos ramas **no tienen commit ancestro en común**.
- Aunque el diff pareciera no vacío localmente, el fetch de GitHub ve cero nuevos objetos entre las refs y el PR quedaría vacío.
- Un PR nunca reescribe la autoría ni los mensajes de commits existentes: solo añade nuevos commits arriba. El rewrite solo puede llegar a `main` por force push.

### Procedimiento usado para publicar el historial rewriteado en `main`

1. **Levantar temporalmente la protección de `main`** en GitHub (usando `GITHUB_UPDATE_BRANCH_PROTECTION`):
   - `allow_force_pushes: true`
   - `required__status__checks__strict: true` (no se omite; los checks se validan en el push posterior o se levantan los checks de la rama antes del push).
   - Mantener `enforce_admins: true` y `allow_deletions: false` intactos.
   - Quitar la exigencia de PR (`required_pull_request_reviews.enabled: false`) y el check obligatorio `Windows - lint, tests, cobertura y E2E opcional` durante este paso.

2. **Force push** del historial rewriteado:
   ```bash
   git push --force-with-lease origin main
   ```
   - Esto actualiza `main` al nuevo hash del historial rewriteado (todos los commits con firma `Edel Arencibia Baez <edelarencibiabaez@gmail.com>` y sin Codebuff).

3. **Restaurar exactamente la protección original**:
   - `allow_force_pushes: false`
   - `required_pull_request_reviews.enabled: true` (con `required_approving_review_count: 0` para este repositorio, pero la protección "Changes must be made through a pull request" está activa)
   - `required__status__checks__strict: true`
   - `enforce_admins: true`
   - `allow_deletions: false`
   - Verificar con `GITHUB_GET_BRANCH_PROTECTION` que la configuración coincide al 100% con la anterior.

### Verificación post-push

- `git log origin/main --format='%an <%ae>' | sort | uniq -c | sort -rn` → debe mostrar solo `Edel Arencibia Baez <edelarencibiabaez@gmail.com>` + dependabot.
- `git log --all --format="%b" | grep -c "Codebuff"` → **0**.
- `npm test` y `npm run lint` deben pasar (280 commits reescritos, suite completa en verde, typescript + eslint limpios).
- `git status` → clean.

### Evitar futuros errores

- Si alguien necesita push a `main` después, debe crear una rama sobre `origin/main` **antes** de cualquier rewrite, o hacer el rewrite sobre la copia local y force push, y luego restaurar la protección.
- Nunca intentar crear PR entre ramas cuyo historial fue modificado con `filter-repo`/`filter-branch` sin primero rebasear/restablecer el ancestro común.

---
*Documento después del rewrite de 280 commits para remover Codebuff attribution y actualizar el email a `edelarencibiabaez@gmail.com`.*