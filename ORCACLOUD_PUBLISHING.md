# Pubblicazione su Orca Cloud

Il workflow `.github/workflows/publish-orcacloud.yml` pubblica con [OIDC trusted publishing](https://cloud.orcaslicer.com/wiki/#publish-from-github), senza segreti.

1. Su https://cloud.orcaslicer.com: **Shared Plugins › nuovo plugin** ("Interfinity Tile Generator"), poi **Edit plugin › GitHub publishing** e inserisci `tommasobbianchi/interfinity-orca-plugin`. Carica le immagini di `docs/` come galleria.
2. Pubblica una GitHub Release (es. `v0.1.0`): il workflow compila i sei target e li carica sul Plugin Hub.
