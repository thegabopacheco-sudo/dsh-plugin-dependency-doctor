# dsh-plugin-dependency-doctor — Dependency Doctor

Audita dependencias locales de un proyecto Node: faltantes en node_modules, extraneas y versiones que no coinciden con package.json, sin red.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `scan` | Auditar dependencias |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-dependency-doctor` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-dependency-doctor
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_DEPENDENCY_DOCTOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\dependency-doctor\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
