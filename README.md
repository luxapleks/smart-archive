# Slim archiveren (lite) – Outlook-add-in

Sla een mail op als bestand met een naam die wél iets zegt, in de goede map:

```
2026-11-09 - Jürgen de Vries (Rabobank) - Alexander Niemeijer - Concept SPA Project Alpha.msg
```

**Werkt volledig lokaal in Outlook.** Er is geen server, geen app-registratie, geen AI en geen admin consent nodig. De mail verlaat Outlook niet. De code wordt alleen als statische website geladen (bijvoorbeeld via GitHub Pages).

## Wat de add-in doet

1. **Bestandsnaam**: `datum - afzender - ontvanger - onderwerp`
   - RE:/FW:/Antw:/Doorst:/[EXTERN] worden weggehaald; is het onderwerp leeg, dan wordt de eerste zin van de mail gebruikt.
   - De organisatie komt uit het maildomein: `jurgen@rabobank.nl` → `Jürgen de Vries (Rabobank)`, `kpmg.com` → `KPMG`. Gmail en Outlook.com worden genegeerd, net als het eigen domein.
   - "Jansen, Piet" wordt "Piet Jansen". Bij verzonden mail wordt de externe ontvanger gekozen.
   - Tekens die Windows/SharePoint weigeren worden verwijderd; de naam is maximaal 150 tekens.
   - Alles is aan te passen; de naam wordt live getoond.
2. **Mapvoorstel**: maximaal 3 mappen uit je eigen mappenlijst, op basis van trefwoorden (afzenderdomein, onderwerp, tekst) en de map die je eerder voor deze afzender of dit domein koos. Via de zoekbox kies je elke andere map of typ je een pad.
3. **Archiveren**: de volledige mail (incl. bijlagen en headers) wordt in Outlook zelf omgezet naar `.msg` (of `.eml`) en als download aangeboden. Het volledige doelpad staat dan op je klembord. Plak dat in het opslagvenster (Ctrl+V, Enter) en het bestand staat in de juiste SharePoint-map. Je kunt het bestand ook naar Verkenner slepen.
4. De mail krijgt de categorie **Gearchiveerd** (maak die categorie eenmalig aan in Outlook).

## Installatie (zonder IT)

### 1. Publiceren op GitHub Pages (eenmalig, ±10 minuten)

1. Maak een (gratis) GitHub-account en een nieuwe repository, bijvoorbeeld `slim-archiveren`.
2. Upload de inhoud van deze map (zonder `node_modules`), of push met git.
3. Kies in de repository **Settings → Pages → Source: GitHub Actions**.
4. Ga naar **Actions** en wacht tot *Publiceren op GitHub Pages* groen is (of start hem via *Run workflow*).
5. Het manifest staat nu op `https://<jouw-naam>.github.io/slim-archiveren/manifest.xml`. Download dat bestand.

> De repository mag openbaar zijn: er staan geen wachtwoorden of gegevens in, alleen de code van de add-in.

### 2. Toevoegen aan Outlook

Open <https://aka.ms/olksideload> (Outlook op het web) → *Mijn invoegtoepassingen* → *Aangepaste invoegtoepassingen* → *Een aangepaste invoegtoepassing toevoegen* → *Toevoegen vanuit bestand* → kies `manifest.xml`.
De knop **Slim archiveren** verschijnt daarna ook in nieuwe Outlook en classic Outlook (bij het lezen van een mail; soms na een herstart).

Zie je de optie *Aangepaste invoegtoepassingen* niet, dan heeft IT het zelf toevoegen uitgezet (Exchange-rol *My Custom Apps*).

### 3. Instellen (⚙ in het paneel)

1. **Basispad**: de map van je gesynchroniseerde SharePoint/Teams-bibliotheek, bijvoorbeeld `C:\Users\jij\Baker Tilly\TAS - Dossiers` (kopieer het uit de adresbalk van Verkenner). Synchroniseer de bibliotheek eerst via *Synchroniseren* of *Snelkoppeling toevoegen aan Mijn bestanden* in SharePoint.
2. **Mappen**: het handigst met de PowerShell-regel uit de instellingen (knop *Commando kopiëren*). Die zet een `mappen.txt` op je bureaublad, die je via *Lijst importeren* inleest. Je kunt de paden ook plakken of met *Map kiezen…* een map aanwijzen (die optie toont alleen mappen waarin bestanden staan).
3. **Opslaan als** `.msg` (standaard) of `.eml`.

Tip: zet in Edge *Instellingen → Downloads → Vragen waar elk bestand moet worden opgeslagen* aan. Dan krijg je altijd het opslagvenster waarin je het gekopieerde pad plakt.

## Lokaal ontwikkelen

```bash
npm install
npm run certs      # eenmalig: https-certificaat voor localhost
npm run dev        # https://localhost:3000
npm run build      # maakt dist/ en manifest.dev.xml (localhost) of dist/manifest.xml (ADDIN_URL)
npm test
```

## Vereisten en beperkingen

- Exporteren van de mail vereist Mailbox-API 1.14: nieuwe Outlook, Outlook op het web en een recente classic Outlook (Microsoft 365). Op oudere versies toont de add-in een melding.
- Downloads werken in Outlook op het web en op Windows. In Outlook voor **Mac** werken downloads uit add-ins niet goed; slepen kan daar wel een alternatief zijn.
- Hoe de download zich gedraagt (opslagvenster of direct naar *Downloads*) hangt af van je browser/Outlook-instellingen. Test dat bij jezelf.
- Een getypt pad naar een map die nog niet bestaat werkt niet in het opslagvenster: maak die map eerst aan in Verkenner.
- Mapvoorstellen gaan op trefwoorden, niet met AI. De volledige versie (met Azure OpenAI en directe upload naar SharePoint) staat in de andere projectmap en vraagt een app-registratie via IT.
- De `.msg` wordt gemaakt met `@tutao/oxmsg` (MIT, port van MsgKit). Die is gecontroleerd met twee onafhankelijke .msg-lezers, maar nog niet in Outlook zelf geopend: open de eerste paar bestanden ter controle. Bij problemen: kies `.eml`.
