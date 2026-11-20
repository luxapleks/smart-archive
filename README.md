# Smart archive – Outlook-add-in

Sla een mail op als bestand met een naam die wél iets zegt, in de goede map:

```
2026-11-09 - Jürgen de Vries (Rabobank) - Alexander Niemeijer - Concept SPA Project Alpha.msg
```

**Werkt volledig lokaal in Outlook.** Er is geen server, geen app-registratie, geen AI en geen admin consent nodig. De mail verlaat Outlook niet. De code wordt alleen als statische website geladen (bijvoorbeeld via GitHub Pages).

## Wat de add-in doet

1. **Bestandsnaam**: `datum - afzender - ontvanger - onderwerp`, met de datum standaard als `jjmmdd` en een pijl tussen afzender en ontvanger: `261120 - JdeVries→ANiemeijer - onderwerp`
   - RE:/FW:/Antw:/Doorst:/[EXTERN] worden weggehaald; is het onderwerp leeg, dan wordt de eerste zin van de mail gebruikt.
   - Namen worden ingekort tot voorletter + achternaam zonder spaties: `Jürgen de Vries` → `JdeVries`, "Niemeijer, Alexander" → `ANiemeijer`.
   - "Jansen, Piet" wordt "Piet Jansen". Bij verzonden mail wordt de externe ontvanger gekozen.
   - Tekens die Windows/SharePoint weigeren worden verwijderd; de naam is maximaal 150 tekens.
   - Alles is aan te passen; de naam wordt live getoond.
2. **Opslaan**: klik op *Map kiezen en opslaan…* en kies in het Verkenner-venster de (klant)map. De add-in zoekt daarbinnen een bestaande map **Inbound**, ook dieper (bv. `Information\Inbound` of `1. Information\02 Inbound`, tot 3 niveaus). Is die er niet, dan wordt `Inbound` direct onder de gekozen map aangemaakt. De gekozen map wordt per afzender en per domein onthouden: de volgende keer is het één klik.
3. **Eén bestand** met bijlagen: `.msg` (standaard) of `.eml`. Bestaat de naam al, dan volgt `… (2).msg`.
   - **Bijlagen** worden daarnaast los opgeslagen in dezelfde map: `261120 Bijlage 1 Concept SPA.pdf`, `261120 Bijlage 2 …`. Logo's uit handtekeningen worden overgeslagen; een bijgevoegde mail krijgt het onderwerp als naam (`.eml`). Uit te zetten in ⚙.
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

### 3. Instellen (⚙ in het paneel, optioneel)

- Formaat `.msg` (standaard) of `.eml`, datumnotatie (jjmmdd, jj-mm-dd, jj mm dd of jjjj-mm-dd), bijlagen los opslaan aan/uit, naam van de submap (standaard `Inbound`), categorie en naamopbouw.
- Maak in Outlook eenmalig de categorie **Gearchiveerd** aan.

Als het Verkenner-venster in het paneel niet mag (Outlook op het web/nieuwe Outlook draaien het paneel in een iframe), opent de add-in een apart venster om de map te kiezen. Kan dat ook niet, dan wordt het bestand gedownload.

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
- Het Verkenner-venster gebruikt de File System Access API van Edge/WebView2. In Outlook voor Mac werkt dit niet.
- De volledige versie (met Azure OpenAI en directe upload naar SharePoint) staat in de andere projectmap en vraagt een app-registratie via IT.
- De `.msg` wordt gemaakt met `@tutao/oxmsg` (MIT, port van MsgKit). Die is gecontroleerd met twee onafhankelijke .msg-lezers, maar nog niet in Outlook zelf geopend: open de eerste paar bestanden ter controle. Bij problemen: kies `.eml`.
