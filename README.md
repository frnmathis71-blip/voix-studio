# Voix Studio

Changeur de voix en temps réel pour Windows : 29 voix, labo de voix, effets sonores, réglages micro (niveau auto, compresseur, égaliseur, porte de bruit) et enregistrement.

## Développer

```bash
npm install
npm start
```

L'interface est dans `app/` (HTML, CSS et JavaScript sans framework). `main.js` gère la fenêtre, l'accès au micro et les mises à jour.

## Construire l'installateur en local

```bash
npm run build
```

L'installateur apparaît dans `dist/Voix-Studio-Setup-<version>.exe`.

## Publier une mise à jour

Les installations existantes vérifient les nouvelles versions au démarrage puis toutes les 30 minutes. Elles téléchargent la mise à jour en arrière-plan et l'installent à la fermeture, ou tout de suite avec le bouton « redémarrer » en haut de la fenêtre.

Pour publier :

```bash
npm run release:patch
```

Cette commande passe la version de 1.0.0 à 1.0.1, crée le tag `v1.0.1` et le pousse sur GitHub. Le workflow `.github/workflows/release.yml` construit alors l'installateur et le publie dans les Releases du dépôt, et les utilisateurs reçoivent la mise à jour. `release:minor` et `release:major` servent aux versions plus importantes.

Le dépôt GitHub doit être **public** (`frnmathis71-blip/voix-studio`, réglé dans `package.json` sous `build.publish`) pour que les installations puissent lire les Releases sans identifiant.

## Envoyer la voix dans Discord, OBS ou un jeu

Installez un câble audio virtuel (par exemple VB-CABLE). Dans Voix Studio, choisissez « CABLE Input » comme sortie virtuelle. Dans l'autre logiciel, choisissez « CABLE Output » comme micro.
