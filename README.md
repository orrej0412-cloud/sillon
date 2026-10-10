# Sillon : lecteur de musique personnel et reconnaissance musicale

Application web installable (PWA) : Android, ordinateur (Chrome, Edge, Firefox), sans compte, sans pub, sans abonnement.
Tes fichiers audio sont **copiés dans le stockage privé de l'application sur ton appareil**.
Seule la reconnaissance musicale envoie quelque chose sur Internet : un court extrait audio, via **ton propre serveur** (voir plus bas).

## Structure

```
sillon/
├── index.html            Coquille de l'appli (menus, mini-lecteur, lecteur plein écran)
├── manifest.webmanifest  Nom, icônes, couleurs (installation)
├── sw.js                 Service worker : installation + fonctionnement hors ligne
├── serve.mjs             Petit serveur local de l'appli (node serve.mjs)
├── package.json          Raccourcis : npm start, npm run server, npm test
├── css/app.css           Tout le style (couleurs en haut du fichier, dans :root)
├── icons/                Icônes de l'appli
├── js/
│   ├── app.js            Point d'entrée : navigation, clics, menus, mise à jour du lecteur
│   ├── views.js          Écrans : Accueil, Bibliothèque, Albums, Artistes, Playlists, Favoris
│   ├── recognize-view.js Écran « Reconnaître » : micro, fichiers, résultats, historique, téléchargements
│   ├── capture.js        Enregistrement micro et extrait de fichier, converti en WAV
│   ├── api.js            Dialogue avec ton serveur de reconnaissance
│   ├── sources.js        Recherche de téléchargements légaux (Jamendo, Internet Archive)
│   ├── match.js          Vérifie que le fichier trouvé est bien le bon titre et la bonne version
│   ├── player.js         Lecture, file d'attente, aléatoire, répétition, position, écran verrouillé
│   ├── library.js        Bibliothèque, import, playlists, favoris
│   ├── metadata.js       Lecture des tags (MP3/ID3, FLAC, M4A, Ogg) + pochettes
│   ├── db.js             Stockage local (IndexedDB)
│   ├── art.js            Couleur dominante de la pochette (ambiance du lecteur)
│   ├── icons.js          Icônes SVG
│   └── util.js           Petites fonctions (formatage, recherche…)
├── server/
│   ├── worker.js         Serveur de reconnaissance (Cloudflare Worker) : garde les clés secrètes
│   ├── dev.mjs           Le même serveur, en local sur l'ordinateur (tests)
│   ├── wrangler.toml     Déploiement en ligne de commande (facultatif)
│   └── .dev.vars.example Modèle de configuration locale, sans secret
└── tests/                Tests automatiques (node --test)
```

Aucune dépendance, aucune compilation : on modifie un fichier, on recharge la page.

## 1. Lancer sur l'ordinateur

Il faut [Node.js](https://nodejs.org) (déjà installé chez toi). Dans le dossier `sillon` :

```
node serve.mjs
```

Ouvre http://localhost:5173 dans Chrome ou Edge. Pour l'installer comme une appli : icône « Installer » à droite de la barre d'adresse.

> Ouvrir directement `index.html` en double-cliquant ne marche pas : le navigateur bloque les modules JavaScript en `file://`.

## 2. L'avoir sur ton téléphone Android

Android n'autorise l'installation, le micro et la lecture en arrière-plan fiable que pour un site en **HTTPS**. Le plus simple et gratuit : GitHub Pages.
Seul le **code** de l'appli est mis en ligne ; tes musiques restent sur ton téléphone.

1. Sur https://github.com, ouvre ton dépôt `sillon` › **Add file** › **Upload files**.
2. Glisse les fichiers et dossiers modifiés (jamais un fichier `.dev.vars`), puis **Commit changes**.
3. Attends une à deux minutes, puis ferme et rouvre Sillon sur le téléphone.

Adresse de l'appli : https://orrej0412-cloud.github.io/sillon/

## 3. Reconnaissance musicale : mise en place (environ 10 minutes, une seule fois)

### Pourquoi un serveur ?

Le service de reconnaissance (AudD) demande une **clé secrète**. Une clé placée dans l'appli serait lisible par n'importe qui
(le code de l'appli est public sur GitHub). On la range donc dans un petit serveur privé, gratuit, chez Cloudflare.
L'appli lui parle avec **ton code d'accès** ; sans ce code, le serveur refuse tout.

```
Téléphone (Sillon) ──extrait 10 s + code d'accès──▶ Ton serveur Cloudflare ──extrait + clé──▶ AudD
                   ◀──────── titre, artiste, pochette, liens ─────────────
```

### Ce que ça coûte (vérifié le 10/10/2026, à revérifier sur les sites officiels)

| Service | À quoi il sert | Gratuit ? |
|---|---|---|
| **Cloudflare Workers** | ton serveur privé | Offre gratuite « Workers Free » : 100 000 requêtes par jour. |
| **AudD** | reconnaître le titre | **300 requêtes offertes** à l'inscription (une seule fois, « pour évaluer »), puis payant : 5 $ les 1 000 requêtes d'après audd.io. **Sans clé**, AudD accepte quelques essais par jour (limite non documentée). |
| **Internet Archive** | téléchargements légaux | Gratuit, sans compte. |
| **Jamendo** (facultatif) | téléchargements légaux | Clé gratuite pour un usage non commercial (quota exact visible dans ton compte développeur). |

Une reconnaissance = 1 requête AudD. Une recherche de téléchargement n'utilise pas AudD.

### Étape A : la clé AudD (conseillée)

1. Va sur https://dashboard.audd.io et crée un compte.
2. Copie ton **API token** affiché dans le tableau de bord.

Tu peux sauter cette étape au début : sans clé, l'appli fonctionne en mode d'essai (quelques reconnaissances par jour).

### Étape B : créer ton serveur Cloudflare (gratuit)

1. Crée un compte sur https://dash.cloudflare.com/sign-up
2. Dans le menu : **Workers & Pages** › **Create** › **Create Worker** (modèle « Hello World »).
   Nomme-le `sillon-api`, puis **Deploy**.
3. Clique **Edit code**. Efface tout le code affiché, colle **tout** le contenu du fichier `server/worker.js`, puis **Deploy**.
4. Retourne sur la page du Worker › **Settings** › **Variables and Secrets** › **Add** :

   | Nom | Type | Valeur |
   |---|---|---|
   | `APP_SECRET` | Secret | ton code d'accès (génère-le dans Sillon : Reconnaître › ⚙ › « Générer un code sûr et le copier ») |
   | `AUDD_API_TOKEN` | Secret | ta clé AudD (étape A), facultatif |
   | `ALLOWED_ORIGINS` | Text | `https://orrej0412-cloud.github.io` |
   | `JAMENDO_CLIENT_ID` | Secret | facultatif (étape D) |

   Clique **Deploy** pour enregistrer.
5. Copie l'adresse du Worker, du type `https://sillon-api.ton-compte.workers.dev`.

Les intitulés de Cloudflare peuvent changer légèrement ; le principe reste : créer un Worker, coller le code, ajouter les variables.

### Étape C : connecter l'appli

Dans Sillon › **Reconnaître** › bouton ⚙ en haut à droite :
colle l'adresse du serveur et ton code d'accès, puis **Enregistrer et tester**.
L'appli affiche ce qui est actif : serveur, clé AudD, Jamendo.

### Étape D (facultatif) : activer Jamendo

1. Crée un compte sur https://devportal.jamendo.com et crée une application.
2. Copie son **Client ID** dans la variable `JAMENDO_CLIENT_ID` de ton Worker.

Sans Jamendo, la recherche de téléchargements utilise seulement Internet Archive.

## Utilisation

- **Reconnaître** : touche le gros bouton, approche le téléphone de la musique pendant 10 secondes.
  Pour un fichier : **Analyser un fichier**, ou menu ⋯ d'un titre de ta bibliothèque › **Identifier ce titre**
  (tu peux ensuite appliquer le titre, l'artiste et la pochette trouvés à ce fichier).
- **Résultat** : titre, artiste, album, pochette, liens d'écoute (Spotify, Deezer, Apple Music) et d'achat (Bandcamp, Qobuz).
  Réponds « C'est le bon titre ? » : les résultats faux sont marqués dans l'historique.
  AudD ne donne pas de score de confiance sur sa formule standard ; c'est pour ça que l'appli te demande de confirmer.
- **Téléchargement légal** : cherche une version gratuite et autorisée (licence Creative Commons ou domaine public) sur Jamendo et Internet Archive.
  Chaque fichier trouvé est noté : *correspondance exacte*, *probable* ou *peu ressemblant*, avec des alertes si la version diffère (remix, live…) ou si la durée ne correspond pas.
  Choisis le format (MP3, FLAC, OGG), suis la progression : le fichier rejoint ta bibliothèque, et tu peux en garder une copie sur l'appareil.
  Pour la plupart des artistes signés en maison de disques, aucun fichier gratuit et légal n'existe : l'appli te propose alors les liens d'achat.
- **Historique** : toutes tes reconnaissances, sur cet appareil uniquement.
- **Accueil** : reprendre l'écoute là où tu t'es arrêté, écoutés récemment, playlists, ajouts récents.
- **Bibliothèque** : recherche (titre, artiste, album, sans tenir compte des accents), tri, vues Titres / Albums / Artistes.
- **Clips vidéo** (MP4, WebM, MOV) : importe-les comme des sons ; le clip tourne en fond pendant la lecture.
- **Lecteur** : aléatoire, répétition, file d'attente, position mémorisée, contrôles sur l'écran verrouillé.
- Raccourcis clavier (ordinateur) : Espace = lecture/pause, ←/→ = ±10 s, Maj+←/→ = titre précédent/suivant.

## Confidentialité

- Le micro ne s'allume que pendant les 10 secondes d'écoute, après un appui sur le bouton.
- Pour reconnaître : un extrait de 10 s (micro) ou 12 s (fichier) va à ton serveur, puis à AudD. Rien d'autre.
- Les clés (AudD, Jamendo) restent sur ton serveur Cloudflare. L'appareil garde seulement l'adresse du serveur et ton code d'accès.
- Pour chercher un téléchargement : titre et artiste vont à Internet Archive (directement) et à Jamendo (via ton serveur).
- Le serveur ne relaie les téléchargements que depuis Jamendo, Internet Archive et les serveurs de pochettes (Apple, Spotify, Deezer).
- L'historique et la bibliothèque restent sur l'appareil.
- Le code de l'appli est public sur GitHub (c'est ce qui permet l'hébergement gratuit), mais sans ton code d'accès, personne ne peut utiliser ton serveur.

## Tests et serveur local

```
node --test "tests/*.test.mjs"
```

25 tests automatiques : serveur (code d'accès, CORS, traduction des réponses et erreurs AudD, Jamendo, relais limité aux sources autorisées),
comparaison titre/version, extraits WAV, lecture des fichiers Internet Archive. Ces tests utilisent des réponses simulées :
ils vérifient la logique, pas les vrais services.

Pour tester le serveur en local avec les vrais services :

1. Copie `server/.dev.vars.example` en `server/.dev.vars` et remplis-le (ne le mets jamais sur GitHub).
2. Lance `node server/dev.mjs` (serveur sur http://localhost:8787), puis l'appli avec `node serve.mjs`.
3. Dans l'appli, utilise l'adresse `http://localhost:8787`.

## Dépannage

| Message | Que faire |
|---|---|
| Micro bloqué | Chrome : icône à gauche de l'adresse › Autorisations › Micro › Autoriser. |
| Code d'accès refusé | Le code saisi dans l'appli doit être identique à `APP_SECRET` dans Cloudflare. |
| Appli non autorisée | `ALLOWED_ORIGINS` doit contenir exactement `https://orrej0412-cloud.github.io` (sans `/sillon`). |
| Quota atteint | Mode d'essai épuisé pour aujourd'hui, ou quota de ta clé AudD terminé : ajoute ou recharge une clé. |
| Clé AudD refusée | Vérifie `AUDD_API_TOKEN` et l'état de ton compte sur dashboard.audd.io. |
| Aucune musique reconnue | Rapproche-toi, limite le bruit, réessaie sur le refrain. Les sons non publiés sont introuvables. |

## À savoir

- **Le stockage est lié au navigateur et à l'adresse.** Si tu effaces les données de Chrome pour ce site, ou si tu désinstalles l'appli, la bibliothèque et l'historique sont vidés. Tes fichiers d'origine ne sont jamais touchés.
- Les fichiers sont copiés : importer 5 Go de musique occupe 5 Go de plus sur le téléphone.
- Lecture selon le navigateur : MP3, M4A/AAC, WAV, FLAC, Ogg/Opus fonctionnent dans Chrome Android. Le format ALAC (M4A Apple sans perte) n'est pas lu par Chrome.
- Les fichiers Creative Commons ont des conditions (citer l'artiste, souvent pas d'usage commercial) : la licence est indiquée à côté de chaque fichier.
