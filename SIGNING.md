# Signer l'app SpecDrive (mac)

Aujourd'hui l'app se construit **sans signature Apple**. Ça marche, mais au premier lancement macOS affiche un avertissement ("app non identifiée") et bloque certaines notifications. Ce guide explique comment débloquer ça, une fois pour toutes.

Coût : **99 $/an** (compte développeur Apple).

## 1. Ouvrir un compte développeur Apple

1. Aller sur https://developer.apple.com/programs/
2. Cliquer "Enroll", suivre les étapes (identité Apple existante ou nouvelle).
3. Payer les 99 $/an.
4. Attendre la validation (souvent quelques heures, parfois 1-2 jours).

## 2. Créer le certificat de signature

1. Sur un Mac, ouvrir **Trousseaux d'accès** (Keychain Access).
2. Menu Trousseaux d'accès → Assistant certificat → Demander un certificat à une autorité de certification.
3. Remplir email + nom, cocher "Enregistré sur le disque", générer le fichier `.certSigningRequest`.
4. Aller sur https://developer.apple.com/account/resources/certificates/list
5. Cliquer "+", choisir **Developer ID Application**, uploader le fichier `.certSigningRequest` de l'étape 3.
6. Télécharger le certificat généré (`.cer`), double-cliquer pour l'installer dans le Trousseau.

## 3. Exporter le certificat en .p12

1. Dans Trousseaux d'accès, trouver le certificat "Developer ID Application: ..." (catégorie "Mes certificats").
2. Clic droit → Exporter.
3. Format : Échange d'informations personnelles (.p12).
4. Choisir un mot de passe fort pour protéger le fichier — c'est le `CSC_KEY_PASSWORD` de l'étape suivante. Le garder de côté, jamais dans le code.

## 4. Créer un mot de passe d'application (pour la notarisation)

1. Aller sur https://appleid.apple.com/account/manage
2. Section "Connexion et sécurité" → "Mots de passe pour applications" → générer un nouveau mot de passe.
3. Le noter — c'est `APPLE_APP_SPECIFIC_PASSWORD`.

## 5. Trouver son Team ID

1. Aller sur https://developer.apple.com/account → section Membership.
2. Le "Team ID" est un code du type `A1B2C3D4E5`.

## 6. Les 5 variables à définir

Avant de lancer `npm run dist` ou `npm run release`, définir ces variables d'environnement (dans le terminal, ou dans un fichier `.env` chargé avant le build — jamais commité dans git) :

| Variable | Valeur |
|---|---|
| `CSC_LINK` | chemin (ou URL) vers le fichier `.p12` exporté à l'étape 3 |
| `CSC_KEY_PASSWORD` | le mot de passe choisi à l'étape 3 |
| `APPLE_ID` | l'email du compte développeur Apple |
| `APPLE_APP_SPECIFIC_PASSWORD` | le mot de passe généré à l'étape 4 |
| `APPLE_TEAM_ID` | le Team ID trouvé à l'étape 5 |

Exemple (terminal, avant le build) :

```bash
export CSC_LINK="/Users/moi/certs/specdrive-cert.p12"
export CSC_KEY_PASSWORD="motdepasse-du-p12"
export APPLE_ID="moi@exemple.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="A1B2C3D4E5"
npm run dist
```

## 7. Une fois les variables définies

`npm run dist` (build local) ou `npm run release` (build + publication GitHub) signent et notarisent **automatiquement** — rien d'autre à faire. Sans ces variables, le build continue de fonctionner normalement mais reste non signé (comme aujourd'hui).

Ce que ça débloque une fois signé :
- Plus d'avertissement Gatekeeper au premier lancement.
- Les notifications macOS natives fonctionnent correctement.
- L'app peut se mettre à jour automatiquement en confiance.

## À propos de `npm run release`

Ce script build l'app et la publie comme une "Release" sur GitHub (pour que l'auto-update fonctionne). Il a besoin en plus d'un `GH_TOKEN` (jeton d'accès personnel GitHub avec droit "repo") :

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxx"
npm run release
```
