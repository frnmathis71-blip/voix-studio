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

## Micro par défaut de Windows

Dans Routage et raccourcis, « Installer le micro virtuel » télécharge le pilote officiel VB-CABLE (vb-audio.com) et lance son installateur. Ensuite, Voix Studio :

- envoie la voix transformée dans « CABLE Input » ;
- fait de « CABLE Output » le micro par défaut de Windows au lancement, pour que Discord, OBS et les jeux réglés sur « Par défaut » l'entendent ;
- rend le micro par défaut d'avant à la fermeture (gardé dans `micro-precedent.json`, même après un plantage) ;
- choisit toujours un micro physique comme source, jamais un micro virtuel (Voicemod, MOTIV Mix, VB-CABLE…) ;
- renomme « CABLE Output » en « Voix Studio » : Discord et les jeux affichent « Voix Studio (VB-Audio Virtual Cable) ». La partie entre parenthèses vient du pilote et ne change pas ;
- propose de régler le délai du câble (`VBAudioCableWDM_Latency` dans `HKLM\SOFTWARE\VB-Audio\Cable`). VB-CABLE est livré à 7 168 échantillons, soit environ 150 ms à 48 kHz ; 2 048 (43 ms) est un bon compromis. Le changement demande les droits administrateur et un redémarrage.

Le changement de périphérique par défaut passe par l'interface COM `IPolicyConfig` de Windows, compilée à la volée par PowerShell (`audio-devices.js`).

## Reprendre les sons d'autres soundboards

« Récupérer mes soundboards » (onglet Effets sonores) importe les sons de Voicemod (cache de VoicemodV3) et de Soundpad. Les sons chiffrés de la bibliothèque Voicemod sont ignorés. « Importer un dossier » reprend tous les fichiers audio d'un dossier.
