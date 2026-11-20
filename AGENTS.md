# AGENTS — Git History Rewrite & GitHub PR Procedure

## ⚠️ PR entre historiales reescritos sin ancestro común

Crear una Pull Request desde una rama cuyo historial ha sido reescrito (p. ej., mediante `git filter-repo` o `git filter-branch`) hacia `main` es **imposible** en GitHub.

### Por qué falla

- GitHub rechaza con: `422 Validation Failed — "The <branch> branch has no history in common with main"`.
- Esto ocurre porque reescribir cambia cada hash de commit, por lo que las dos ramas **no tienen commit ancestro en común**.
- Aunque el diff pareciera no vacío localmente, el fetch de GitHub ve cero nuevos objetos entre las refs y el PR quedaría vacío.
- Un PR nunca reescribe la autoría ni los mensajes de commits existentes: solo añade nuevos commits arriba. El rewrite solo puede llegar a `main` por force push.

### Procedimiento usado para publicar el historial rewriteado en `main`

1. **Levantar temporalmente la protección de `main`** a mano en la web del repositorio (**Settings → Rules → ruleset de `main`**, o **Settings → Branches** si sigue la configuración clásica): no hay herramienta de agente que la cambie, y la API REST equivalente (`PUT /repos/{owner}/{repo}/branches/main/protection`) exige un token de administración que no vive en el repo.
   - `allow_force_pushes: true`
   - Quitar la exigencia de PR (`required_pull_request_reviews`) y el check obligatorio `Windows - lint, tests, cobertura y E2E opcional` durante este paso: son los dos únicos que bloquean un push directo.
   - Mantener `required_status_checks.strict: true`, `enforce_admins: true` y `allow_deletions: false` intactos; el `strict` se configura aquí y solo vuelve a exigirse cuando el paso 3 devuelve la PR y el check.

2. **Force push** del historial rewriteado, atado al commit que hoy tiene el remoto:
   ```bash
   git rev-parse origin/main   # debe imprimir fc6586e58b4c8ed714d3981743da4d86b4e6db52
   git push --force-with-lease=main:fc6586e58b4c8ed714d3981743da4d86b4e6db52 origin main
   ```
   - Sin `=main:<ref-vieja>` el lease no comprueba nada útil: se limita al valor de `origin/main` del último fetch. Con el hash explícito, el push se rechaza si alguien movió `main` desde ese commit y toca revisar qué entró antes de reintentar.
   - `fc6586e58b4c8ed714d3981743da4d86b4e6db52` es el `origin/main` observado al preparar el rewrite; si el `git rev-parse` de arriba imprime otro, sustituirlo en el push.
   - Esto actualiza `main` al nuevo hash del historial rewriteado (todos los commits con firma `Edel Arencibia Baez <edelarencibiabaez@gmail.com>` y sin Codebuff).

3. **Restaurar exactamente la protección original**:
   - `allow_force_pushes: false`
   - `required_pull_request_reviews` activo (con `required_approving_review_count: 0` para este repositorio, pero la protección "Changes must be made through a pull request" está activa), y el check `Windows - lint, tests, cobertura y E2E opcional` obligatorio otra vez.
   - `required_status_checks.strict: true`, `enforce_admins: true` y `allow_deletions: false`.
   - Verificar en la web que la tarjeta del ruleset coincide al 100% con la anterior; para automatizarlo, `GET /repos/{owner}/{repo}/branches/main/protection` desde un cliente con token de administración.

### Verificación post-push

- `git log origin/main --format='%an <%ae> | %cn <%ce>' | sort | uniq -c | sort -rn` → solo tres formas: autor `Edel Arencibia Baez <edelarencibiabaez@gmail.com>` con committer idéntico, la misma autora con committer `GitHub <noreply@github.com>` en los merges hechos desde la web, y las de dependabot. Ninguna línea con otra firma: el rewrite también reescribió `%cn`/`%ce`, así que filtrar solo por `%an`/`%ae` dejaría pasar un committer viejo.
- `git log --all --format="%b" | grep -c "Codebuff"` → **0**.
- `npm test` y `npm run lint` deben pasar (280 commits reescritos, suite completa en verde, typescript + eslint limpios).
- `git status` → clean.

### Evitar futuros errores

- Si alguien necesita push a `main` después, debe crear una rama sobre `origin/main` **antes** de cualquier rewrite, o hacer el rewrite sobre la copia local y force push, y luego restaurar la protección.
- Nunca intentar crear PR entre ramas cuyo historial fue modificado con `filter-repo`/`filter-branch` sin primero rebasear/restablecer el ancestro común.

---
*Documento después del rewrite de 280 commits para remover Codebuff attribution y actualizar el email a `edelarencibiabaez@gmail.com`.*