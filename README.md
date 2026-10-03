# Sillon — lecteur de musique personnel

Application web installable (PWA) : Android, ordinateur (Chrome, Edge, Firefox), sans compte, sans pub, sans abonnement.
Tes fichiers audio sont **copiés dans le stockage privé de l'application sur ton appareil**. Rien n'est envoyé sur Internet.

## Structure

```
sillon/
├── index.html            Coquille de l'appli (menus, mini-lecteur, lecteur plein écran)
├── manifest.webmanifest  Nom, icônes, couleurs (installation)
├── sw.js                 Service worker : installation + fonctionnement hors ligne
├── serve.mjs             Petit serveur local (node serve.mjs)
├── css/app.css           Tout le style (couleurs en haut du fichier, dans :root)
├── icons/                Icônes de l'appli
└── js/
    ├── app.js            Point d'entrée : navigation, clics, menus, mise à jour du lecteur
    ├── views.js          Écrans : Accueil, Bibliothèque, Albums, Artistes, Playlists, Favoris
    ├── player.js         Lecture, file d'attente, aléatoire, répétition, position, écran verrouillé
    ├── library.js        Bibliothèque, import, playlists, favoris
    ├── metadata.js       Lecture des tags (MP3/ID3, FLAC, M4A, Ogg) + pochettes
    ├── db.js             Stockage local (IndexedDB)
    ├── art.js            Couleur dominante de la pochette (ambiance du lecteur)
    ├── icons.js          Icônes SVG
    └── util.js           Petites fonctions (formatage, recherche…)
```

Aucune dépendance, aucune compilation : on modifie un fichier, on recharge la page.

## 1. Lancer sur l'ordinateur

Il faut [Node.js](https://nodejs.org) (déjà installé chez toi).

```
cd sillon
node serve.mjs
```

Ouvre http://localhost:5173 dans Chrome ou Edge. Pour l'installer comme une appli : icône « Installer » à droite de la barre d'adresse.

> Ouvrir directement `index.html` en double-cliquant ne marche pas : le navigateur bloque les modules JavaScript en `file://`.

## 2. L'avoir sur ton téléphone Android

Android n'autorise l'installation et la lecture en arrière-plan fiable que pour un site en **HTTPS**. Le plus simple et gratuit : GitHub Pages.
Seul le **code** de l'appli est mis en ligne ; tes musiques restent sur ton téléphone et personne d'autre ne peut y accéder.

1. Crée un compte gratuit sur https://github.com (une seule fois).
2. Clique sur **+** › **New repository**. Nom : `sillon`. Laisse **Public** (obligatoire pour Pages gratuit). Clique **Create repository**.
3. Clique sur **uploading an existing file**, puis glisse **le contenu** du dossier `sillon` (index.html, css, js, icons, sw.js, manifest.webmanifest…). Clique **Commit changes**.
4. Va dans **Settings** › **Pages**. Dans « Branch », choisis `main` et `/ (root)`, puis **Save**.
5. Attends une à deux minutes : l'adresse s'affiche, du type `https://ton-pseudo.github.io/sillon/`.
6. Sur ton téléphone, ouvre cette adresse dans **Chrome**.
7. Menu **⋮** › **Ajouter à l'écran d'accueil** › **Installer**. L'icône Sillon apparaît comme une vraie appli.
8. Ouvre Sillon, touche **Importer**, choisis tes fichiers (MP3, FLAC, WAV, M4A). Ils sont copiés dans l'appli.

Pour une mise à jour du code : renvoie les fichiers modifiés sur GitHub (étape 3), puis ferme et rouvre l'appli.

## Utilisation

- **Accueil** : reprendre l'écoute là où tu t'es arrêté, écoutés récemment, playlists, ajouts récents.
- **Bibliothèque** : recherche (titre, artiste, album, sans tenir compte des accents), tri, vues Titres / Albums / Artistes.
- **Menu ⋯ d'un titre** : lire ensuite, file d'attente, ajouter à une playlist, favori, lire depuis le début, supprimer.
- **Mini-lecteur** en bas ; touche-le pour le **lecteur plein écran** (glisse vers le bas ou bouton retour pour le fermer).
- **Aléatoire** et **répétition** (liste → titre → désactivé) dans le lecteur.
- La position de chaque titre est mémorisée automatiquement (barre orange sous le titre).
- Écran verrouillé et notification : lecture/pause, précédent/suivant, barre de progression.
- Raccourcis clavier (ordinateur) : Espace = lecture/pause, ←/→ = ±10 s, Maj+←/→ = titre précédent/suivant.
- Ordinateur : glisser-déposer de fichiers ou d'un dossier entier.

## À savoir

- **Le stockage est lié au navigateur et à l'adresse.** Si tu effaces les données de Chrome pour ce site, ou si tu désinstalles l'appli, la bibliothèque est vidée. Tes fichiers d'origine, eux, ne sont jamais touchés.
- L'ordinateur et le téléphone ont chacun leur propre bibliothèque (pas de synchronisation, c'est voulu : rien ne transite par Internet).
- Les fichiers sont copiés : importer 5 Go de musique occupe 5 Go de plus sur le téléphone. Tu peux ensuite supprimer les originaux si tu veux.
- Lecture selon le navigateur : MP3, M4A/AAC, WAV, FLAC, Ogg/Opus fonctionnent dans Chrome Android. Le format ALAC (M4A Apple sans perte) n'est pas lu par Chrome.
- iPhone : l'appli marche dans Safari, mais iOS coupe souvent le son des web-apps en arrière-plan.
