import type { Locale } from "./i18n";

/** Which interactive tool (or the app's download buttons) a translated page
 * embeds. The tools' own controls are still in English. */
export type LocalizedDemo = "download" | "background" | "sharpen" | "frame";

export type LocalizedPage = {
  /** The English original; keys TRANSLATED_PATHS. */
  enPath: string;
  demo: LocalizedDemo;
  title: string;
  description: string;
  badge: string;
  /** Before, highlighted, after. */
  h1: [string, string, string];
  intro: string;
  guideTitle: string;
  steps: string[];
  facts: { label: string; value: string }[];
  faqTitle: string;
  faqs: { q: string; a: string }[];
};

/** Strings shared by every translated page. */
export const UI: Record<Locale, { factsTitle: string; otherLanguages: string; freeTools: string }> = {
  de: { factsTitle: "Auf einen Blick", otherLanguages: "Diese Seite auf", freeTools: "Kostenlose Tools" },
  fr: { factsTitle: "En bref", otherLanguages: "Cette page en", freeTools: "Outils gratuits" },
  es: { factsTitle: "De un vistazo", otherLanguages: "Esta página en", freeTools: "Herramientas gratis" },
};

/** Translations of the English pages, keyed by the same slugs as
 * TRANSLATED_PATHS. Facts and limits must match the English pages: change
 * both together. */
export const PAGES: Record<Locale, Record<string, LocalizedPage>> = {
  de: {
    "": {
      enPath: "/download",
      demo: "download",
      title: "Kostenloser Bildschirmrekorder & Videoeditor für Windows und Mac",
      description:
        "Bildschirm aufnehmen, Pausen mit einem Klick schneiden, automatische Zooms und Untertitel hinzufügen. Kostenlos für Windows und macOS.",
      badge: "Kostenlos für Windows & Mac",
      h1: ["Bildschirm aufnehmen, ", "Videos schneiden", ", kostenlos"],
      intro:
        "WipeClip ist ein kostenloser Bildschirmrekorder und Videoeditor für Windows und Mac. Zooms folgen automatisch jedem Klick, Pausen schneidest du mit einem Klick heraus, und Untertitel entstehen direkt auf deinem Computer.",
      guideTitle: "So erstellst du ein Video mit WipeClip",
      steps: [
        "Lade WipeClip für Windows oder macOS herunter und installiere die App.",
        "Nimm den ganzen Bildschirm, ein Fenster oder einen Bereich auf. Systemton, Mikrofon und Webcam werden als getrennte Spuren gespeichert.",
        "Übernimm die vorgeschlagenen Zooms auf deine Klicks oder passe sie an.",
        "Schneide lange Pausen und Leerlauf heraus und erzeuge Untertitel auf deinem eigenen Computer.",
        "Exportiere ein MP4 und Untertitel (.srt oder .vtt) direkt auf deine Festplatte.",
      ],
      facts: [
        { label: "Systeme", value: "Windows 10 (21H2+), Windows 11, macOS 11+" },
        { label: "Preis", value: "Kostenlos, optionale Pässe ohne Abo" },
        { label: "Aufnahme", value: "Bildschirm, Fenster oder Bereich" },
        { label: "Untertitel", value: "Auf dem Gerät erstellt, .srt und .vtt" },
        { label: "Formate", value: "Quer, Hochformat, Quadrat" },
      ],
      faqTitle: "Häufige Fragen zu WipeClip",
      faqs: [
        {
          q: "Ist WipeClip kostenlos?",
          a: "Ja. Herunterladen, aufnehmen und bearbeiten ist kostenlos. Mit einer Anmeldung erhältst du Exporte in voller Auflösung, die Credits verbrauchen. Kostenlose Credits gibt es jeden Tag neu, und optionale Pässe ohne Abo schalten Premium-Effekte und 4K frei.",
        },
        {
          q: "Welche Systeme werden unterstützt?",
          a: "Windows 10 (21H2 oder neuer), Windows 11 und macOS 11 oder neuer.",
        },
        {
          q: "Werden meine Aufnahmen hochgeladen?",
          a: "Nein. Aufnahmen werden in einem Ordner auf deinem Computer gespeichert, und Aufnahme, Schnitt, Analyse und Untertitel laufen dort. Ein Video wird nur beim Export hochgeladen, in temporärem Speicher verarbeitet und nicht aufbewahrt.",
        },
        {
          q: "Warum meldet Windows „Der Computer wurde durch Windows geschützt“?",
          a: "Windows warnt bei neuen Apps, die noch nicht oft heruntergeladen wurden. Klicke im Installer auf „Weitere Informationen“ und dann auf „Trotzdem ausführen“. Nach der Installation aktualisiert sich die App selbst.",
        },
        {
          q: "In welcher Sprache ist die App?",
          a: "Die Oberfläche der App ist derzeit auf Englisch.",
        },
      ],
    },
    "hintergrund-entfernen": {
      enPath: "/remove-background",
      demo: "background",
      title: "Hintergrund entfernen – kostenlos als transparentes PNG",
      description:
        "Lade ein Foto hoch und erhalte in Sekunden ein PNG mit transparentem Hintergrund. Ein kostenloses Ergebnis pro Tag, ohne Konto.",
      badge: "Kostenloses Tool",
      h1: ["Den ", "Hintergrund", " aus jedem Foto entfernen"],
      intro:
        "Foto hochladen, transparentes PNG zurückbekommen. Nichts markieren, kein Konto für die Vorschau. Setze das Motiv einfach auf den Hintergrund, den du brauchst.",
      guideTitle: "So entfernst du den Hintergrund eines Fotos",
      steps: [
        "Ziehe ein JPG-, PNG- oder WebP-Foto (bis 25 MB) in das Upload-Feld oder klicke darauf, um eine Datei auszuwählen.",
        "WipeClip erkennt das Motiv automatisch. Du musst nichts nachzeichnen oder markieren.",
        "Prüfe die freigestellte Vorschau vor dem transparenten Schachbrettmuster.",
        "Lade das Ergebnis als PNG mit transparentem Hintergrund herunter und setze es auf einen neuen Hintergrund.",
      ],
      facts: [
        { label: "Ausgabe", value: "PNG mit Transparenz" },
        { label: "Max. Upload", value: "25 MB pro Bild" },
        { label: "Kostenlos", value: "1 Freisteller pro Tag, verkleinert" },
        { label: "Angemeldet", value: "Volle Auflösung, 1 Credit pro Bild" },
        { label: "Gratis-Credits", value: "2 pro Tag für jedes Konto" },
      ],
      faqTitle: "Hintergrund entfernen: häufige Fragen",
      faqs: [
        {
          q: "Ist das wirklich kostenlos?",
          a: "Ja. Jeder bekommt einen kostenlosen Freisteller pro Tag in reduzierter Größe, ohne Konto. Für das Ergebnis in voller Auflösung meldest du dich an: Es kostet 1 Credit, und jedes Konto erhält 2 kostenlose Credits pro Tag.",
        },
        {
          q: "Welches Dateiformat bekomme ich?",
          a: "Ein PNG mit transparentem Alphakanal. So kannst du das Motiv direkt auf einen neuen Hintergrund, eine Produktseite oder eine Folie setzen.",
        },
        {
          q: "Eignet sich das für Produktfotos?",
          a: "Ja. Das freigestellte PNG lässt sich auf einen weißen oder farbigen Hintergrund setzen, wie ihn viele Online-Marktplätze und Shops für Produktbilder verlangen.",
        },
        {
          q: "Sehen die Kanten bei Haaren oder feinen Details unsauber aus?",
          a: "Nach dem ersten Schnitt bereinigt WipeClip die Kanten und glättet den Alphakanal, damit Säume und raue Ränder an feinen Details verschwinden.",
        },
        {
          q: "Speichert ihr mein Foto?",
          a: "Nein. Das Foto wird verarbeitet, um dein PNG zu erstellen, und danach gelöscht. Es wird nie zum Trainieren eines Modells verwendet.",
        },
      ],
    },
    "bild-schaerfen": {
      enPath: "/sharpen-image",
      demo: "sharpen",
      title: "Unscharfes Foto schärfen – kostenlos",
      description:
        "Bring feine Details in ein weiches oder leicht unscharfes Foto zurück. Ein kostenloses Ergebnis pro Tag, ohne Konto. Stärke: leicht, standard oder stark.",
      badge: "Kostenloses Tool",
      h1: ["Ein ", "weiches oder unscharfes", " Foto schärfen"],
      intro: "Foto hochladen, Stärke wählen und klarere Details zurückbekommen, ohne Konto für die Vorschau.",
      guideTitle: "So schärfst du ein weiches Foto",
      steps: [
        "Ziehe ein JPG-, PNG- oder WebP-Foto (bis 25 MB) in das Upload-Feld oder klicke darauf, um eine Datei auszuwählen.",
        "Wähle eine Stärke: Light für Haut und Himmel, Standard für die meisten Fotos, Strong für Fotos, die danach noch weich wirken.",
        "Vergleiche das Ergebnis direkt mit dem Original.",
        "Lade das geschärfte Foto herunter. Es behält die Pixelmaße deines Uploads.",
      ],
      facts: [
        { label: "Stärken", value: "Light, Standard, Strong" },
        { label: "Max. Upload", value: "25 MB pro Bild" },
        { label: "Kostenlos", value: "1 Foto pro Tag, verkleinert" },
        { label: "Volle Auflösung", value: "1 Credit pro Foto, 2 Gratis-Credits pro Tag" },
      ],
      faqTitle: "Foto schärfen: häufige Fragen",
      faqs: [
        {
          q: "Rettet das ein stark verwackeltes oder unscharfes Foto?",
          a: "Nein. Das Tool stellt lokalen Kontrast und Kantendetails bei einem Foto wieder her, das grundsätzlich scharf ist, aber etwas weich wirkt, etwa nach Kompression oder Verkleinerung. Details, die nie aufgenommen wurden, kann es nicht erfinden.",
        },
        {
          q: "Wird die Auflösung erhöht?",
          a: "Nein. Das Ergebnis hat dieselben Pixelmaße wie dein Upload. Das Tool verbessert die Klarheit bei gleicher Auflösung.",
        },
        {
          q: "Was ist der Unterschied zwischen Light, Standard und Strong?",
          a: "Wie stark der lokale Kontrast an erkannten Kanten angehoben wird. Standard passt für die meisten Fotos, Light vermeidet Überschärfen bei Haut oder Himmel, Strong ist für Fotos, die nach Standard noch weich wirken.",
        },
        {
          q: "Ist das kostenlos?",
          a: "Ja. Jeder bekommt ein kostenloses geschärftes Foto pro Tag in reduzierter Größe, ohne Konto. Für die volle Auflösung meldest du dich an: Es kostet 1 Credit, und jedes Konto erhält 2 kostenlose Credits pro Tag.",
        },
        {
          q: "Speichert ihr mein Foto?",
          a: "Nein. Das Foto wird verarbeitet und danach gelöscht. Es wird nie zum Trainieren eines Modells verwendet.",
        },
      ],
    },
    "standbild-aus-video": {
      enPath: "/extract-video-frame",
      demo: "frame",
      title: "Standbild aus Video extrahieren – kostenlos, ohne Upload",
      description:
        "Speichere jedes Bild aus einem Video als PNG-Screenshot oder Thumbnail. Läuft komplett im Browser, ohne Upload. Ein kostenloser Download pro Tag.",
      badge: "Kostenlos • Ohne Upload",
      h1: ["Ein ", "Standbild", " aus jedem Video speichern"],
      intro:
        "Spule zum gewünschten Moment und speichere ihn als PNG, bis zur vollen Auflösung. Alles läuft in deinem Browser. Dein Video wird nie hochgeladen.",
      guideTitle: "So speicherst du ein Bild aus einem Video",
      steps: [
        "Öffne ein Video, das dein Browser abspielen kann (MP4 oder WebM, bis 500 MB). Es bleibt auf deinem Gerät.",
        "Spule zum gewünschten Moment oder wähle eines der vorgeschlagenen Titelbilder, die WipeClip im Video findet.",
        "Nimm das Bild auf. Du kannst so viele aufnehmen, wie du möchtest.",
        "Lade einmal pro Tag ein Bild kostenlos in reduzierter Größe herunter oder in voller Auflösung für 1 Credit.",
      ],
      facts: [
        { label: "Ausgabe", value: "PNG, bis zur Auflösung des Videos" },
        { label: "Max. Videogröße", value: "500 MB" },
        { label: "Upload", value: "Keiner, läuft im Browser" },
        { label: "Kostenlos", value: "1 Download pro Tag, niedrige Auflösung" },
        { label: "Volle Auflösung", value: "1 Credit pro Bild, Anmeldung nötig" },
      ],
      faqTitle: "Standbild aus Video: häufige Fragen",
      faqs: [
        {
          q: "Wird mein Video irgendwo hochgeladen?",
          a: "Nein. Das Video wird komplett in deinem Browser-Tab dekodiert und gezeichnet und nie an die Server von WipeClip.co gesendet. Videos bis 500 MB in einem Format, das dein Browser abspielen kann (meist MP4 oder WebM), funktionieren.",
        },
        {
          q: "Wie viele Bilder kann ich aufnehmen?",
          a: "Aufnehmen und ansehen kannst du beliebig viele. Beim Download gilt ein Limit: ein kostenloses Bild pro Tag in niedriger Auflösung, und jedes Bild in voller Auflösung kostet 1 Credit. Jedes Konto erhält 2 kostenlose Credits pro Tag.",
        },
        {
          q: "Welche Auflösung hat das exportierte Bild?",
          a: "Ein Download in voller Auflösung ist ein PNG in der nativen Auflösung des Videos. Der kostenlose Download pro Tag ist auf etwa 0,25 Megapixel verkleinert.",
        },
        {
          q: "Und wenn ich das ganze Video bearbeiten will?",
          a: "Dieses Tool speichert ein einzelnes Standbild. Zum Schneiden, Untertiteln oder Umstellen des ganzen Clips nutzt du den kostenlosen Videoeditor von WipeClip.co für Windows und Mac.",
        },
      ],
    },
  },
  fr: {
    "": {
      enPath: "/download",
      demo: "download",
      title: "Enregistreur d'écran et éditeur vidéo gratuit pour Windows et Mac",
      description:
        "Enregistrez votre écran, coupez les pauses en un clic, ajoutez des zooms automatiques et des sous-titres. Gratuit pour Windows et macOS.",
      badge: "Gratuit pour Windows et Mac",
      h1: ["Enregistrez votre écran, ", "montez vos vidéos", ", gratuitement"],
      intro:
        "WipeClip est un enregistreur d'écran et un éditeur vidéo gratuit pour Windows et Mac. Les zooms suivent automatiquement chaque clic, les pauses se coupent en un clic et les sous-titres sont générés sur votre propre ordinateur.",
      guideTitle: "Comment créer une vidéo avec WipeClip",
      steps: [
        "Téléchargez WipeClip pour Windows ou macOS et installez l'application.",
        "Enregistrez tout l'écran, une fenêtre ou une zone. Le son système, le micro et la webcam sont enregistrés sur des pistes séparées.",
        "Acceptez les zooms proposés sur vos clics ou ajustez-les.",
        "Coupez les longues pauses et les temps morts, puis générez les sous-titres sur votre ordinateur.",
        "Exportez un MP4 et des sous-titres (.srt ou .vtt) directement sur votre disque.",
      ],
      facts: [
        { label: "Systèmes", value: "Windows 10 (21H2+), Windows 11, macOS 11+" },
        { label: "Prix", value: "Gratuit, passes optionnels sans abonnement" },
        { label: "Enregistrement", value: "Écran, fenêtre ou zone" },
        { label: "Sous-titres", value: "Générés sur l'appareil, .srt et .vtt" },
        { label: "Formats", value: "Paysage, vertical, carré" },
      ],
      faqTitle: "Questions fréquentes sur WipeClip",
      faqs: [
        {
          q: "WipeClip est-il gratuit ?",
          a: "Oui. Le téléchargement, l'enregistrement et le montage sont gratuits. En vous connectant, vous obtenez des exports en pleine résolution qui utilisent des crédits. Des crédits gratuits sont offerts chaque jour, et des passes optionnels sans abonnement débloquent les effets premium et la 4K.",
        },
        {
          q: "Quels systèmes sont pris en charge ?",
          a: "Windows 10 (21H2 ou plus récent), Windows 11 et macOS 11 ou plus récent.",
        },
        {
          q: "Mes enregistrements sont-ils envoyés en ligne ?",
          a: "Non. Les enregistrements sont sauvegardés dans un dossier sur votre ordinateur, et l'enregistrement, le montage, l'analyse et les sous-titres s'y déroulent. Une vidéo n'est envoyée que lors de l'export, traitée dans un stockage temporaire et n'est pas conservée.",
        },
        {
          q: "Pourquoi Windows affiche « Windows a protégé votre ordinateur » ?",
          a: "Windows avertit pour les nouvelles applications encore peu téléchargées. Dans l'installateur, cliquez sur « Informations complémentaires », puis sur « Exécuter quand même ». Une fois installée, l'application se met à jour toute seule.",
        },
        {
          q: "Dans quelle langue est l'application ?",
          a: "L'interface de l'application est pour l'instant en anglais.",
        },
      ],
    },
    "supprimer-arriere-plan": {
      enPath: "/remove-background",
      demo: "background",
      title: "Supprimer l'arrière-plan d'une image – gratuit, PNG transparent",
      description:
        "Importez une photo et obtenez un PNG à fond transparent en quelques secondes. Un résultat gratuit par jour, sans compte.",
      badge: "Outil gratuit",
      h1: ["Supprimez l'", "arrière-plan", " de n'importe quelle photo"],
      intro:
        "Importez une photo, récupérez un PNG transparent. Rien à détourer, aucun compte nécessaire pour l'aperçu. Placez ensuite le sujet sur le fond de votre choix.",
      guideTitle: "Comment supprimer l'arrière-plan d'une photo",
      steps: [
        "Déposez une photo JPG, PNG ou WebP (jusqu'à 25 Mo) dans la zone d'import, ou cliquez dessus pour choisir un fichier.",
        "WipeClip détecte le sujet automatiquement. Rien à tracer ni à marquer.",
        "Vérifiez l'aperçu détouré sur le damier transparent.",
        "Téléchargez le résultat en PNG à fond transparent et placez-le sur un nouveau fond.",
      ],
      facts: [
        { label: "Sortie", value: "PNG avec transparence" },
        { label: "Import max.", value: "25 Mo par image" },
        { label: "Gratuit", value: "1 détourage par jour, taille réduite" },
        { label: "Connecté", value: "Pleine résolution, 1 crédit par image" },
        { label: "Crédits gratuits", value: "2 par jour, pour chaque compte" },
      ],
      faqTitle: "Supprimer l'arrière-plan : questions fréquentes",
      faqs: [
        {
          q: "C'est vraiment gratuit ?",
          a: "Oui. Tout le monde a droit à un détourage gratuit par jour en taille réduite, sans compte. Pour la pleine résolution, connectez-vous : cela coûte 1 crédit, et chaque compte reçoit 2 crédits gratuits par jour.",
        },
        {
          q: "Quel format de fichier vais-je obtenir ?",
          a: "Un PNG avec un canal alpha transparent, pour poser le sujet directement sur un nouveau fond, une fiche produit ou une diapositive.",
        },
        {
          q: "Est-ce adapté aux photos de produits ?",
          a: "Oui. Le PNG détouré se pose sur un fond blanc ou coloré, comme l'exigent de nombreuses places de marché et boutiques en ligne pour les photos de produits.",
        },
        {
          q: "Les contours des cheveux ou des détails fins seront-ils nets ?",
          a: "Après la première découpe, WipeClip nettoie les bords et lisse le canal alpha pour éliminer les halos et les contours irréguliers autour des détails fins.",
        },
        {
          q: "Conservez-vous ma photo ?",
          a: "Non. La photo est traitée pour créer votre PNG, puis supprimée. Elle n'est jamais utilisée pour entraîner un modèle.",
        },
      ],
    },
    "rendre-photo-nette": {
      enPath: "/sharpen-image",
      demo: "sharpen",
      title: "Rendre une photo floue plus nette – gratuit",
      description:
        "Redonnez du détail à une photo douce ou légèrement floue en quelques secondes. Un résultat gratuit par jour, sans compte. Intensité légère, standard ou forte.",
      badge: "Outil gratuit",
      h1: ["Rendez nette une photo ", "douce ou floue", ""],
      intro: "Importez une photo, choisissez l'intensité et récupérez des détails plus nets, sans compte pour l'aperçu.",
      guideTitle: "Comment rendre une photo plus nette",
      steps: [
        "Déposez une photo JPG, PNG ou WebP (jusqu'à 25 Mo) dans la zone d'import, ou cliquez dessus pour choisir un fichier.",
        "Choisissez une intensité : Light pour la peau et le ciel, Standard pour la plupart des photos, Strong pour les photos encore douces.",
        "Comparez le résultat avec l'original côte à côte.",
        "Téléchargez la photo améliorée. Elle garde les dimensions en pixels de votre import.",
      ],
      facts: [
        { label: "Intensités", value: "Light, Standard, Strong" },
        { label: "Import max.", value: "25 Mo par image" },
        { label: "Gratuit", value: "1 photo par jour, taille réduite" },
        { label: "Pleine résolution", value: "1 crédit par photo, 2 crédits gratuits par jour" },
      ],
      faqTitle: "Netteté des photos : questions fréquentes",
      faqs: [
        {
          q: "Est-ce que cela corrige une photo très floue ou bougée ?",
          a: "Non. L'outil restaure le contraste local et les détails des contours d'une photo globalement nette mais un peu douce, par exemple après compression ou redimensionnement. Il ne peut pas recréer des détails jamais capturés.",
        },
        {
          q: "La résolution de l'image augmente-t-elle ?",
          a: "Non. Le résultat a les mêmes dimensions en pixels que votre import. L'outil améliore la clarté à résolution égale.",
        },
        {
          q: "Quelle différence entre Light, Standard et Strong ?",
          a: "Le niveau d'accentuation du contraste local autour des contours détectés. Standard convient à la plupart des photos, Light évite d'accentuer la peau ou le ciel, Strong sert aux photos encore douces après Standard.",
        },
        {
          q: "Est-ce gratuit ?",
          a: "Oui. Tout le monde a droit à une photo améliorée gratuite par jour en taille réduite, sans compte. Pour la pleine résolution, connectez-vous : cela coûte 1 crédit, et chaque compte reçoit 2 crédits gratuits par jour.",
        },
        {
          q: "Conservez-vous ma photo ?",
          a: "Non. La photo est traitée puis supprimée. Elle n'est jamais utilisée pour entraîner un modèle.",
        },
      ],
    },
    "extraire-image-video": {
      enPath: "/extract-video-frame",
      demo: "frame",
      title: "Extraire une image d'une vidéo – gratuit, sans envoi",
      description:
        "Enregistrez n'importe quelle image d'une vidéo en PNG, comme capture ou miniature. Tout se fait dans le navigateur, sans envoi. Un téléchargement gratuit par jour.",
      badge: "Gratuit • Sans envoi",
      h1: ["Extrayez une ", "image", " de n'importe quelle vidéo"],
      intro:
        "Placez-vous au moment voulu et enregistrez-le en PNG, jusqu'à la pleine résolution. Tout se passe dans votre navigateur. Votre vidéo n'est jamais envoyée.",
      guideTitle: "Comment enregistrer une image d'une vidéo",
      steps: [
        "Ouvrez une vidéo lisible par votre navigateur (MP4 ou WebM, jusqu'à 500 Mo). Elle reste sur votre appareil.",
        "Placez-vous au moment voulu, ou choisissez une des images de couverture que WipeClip propose en analysant la vidéo.",
        "Capturez l'image. Capturez-en autant que vous voulez.",
        "Téléchargez une image gratuite en taille réduite une fois par jour, ou en pleine résolution pour 1 crédit.",
      ],
      facts: [
        { label: "Sortie", value: "PNG, jusqu'à la résolution de la vidéo" },
        { label: "Taille max.", value: "500 Mo" },
        { label: "Envoi", value: "Aucun, tout se fait dans le navigateur" },
        { label: "Gratuit", value: "1 téléchargement par jour, basse résolution" },
        { label: "Pleine résolution", value: "1 crédit par image, connexion requise" },
      ],
      faqTitle: "Extraire une image : questions fréquentes",
      faqs: [
        {
          q: "Ma vidéo est-elle envoyée quelque part ?",
          a: "Non. La vidéo est décodée et dessinée entièrement dans l'onglet de votre navigateur, et n'est jamais envoyée aux serveurs de WipeClip.co. Les vidéos jusqu'à 500 Mo dans un format lisible par votre navigateur (généralement MP4 ou WebM) fonctionnent.",
        },
        {
          q: "Combien d'images puis-je capturer ?",
          a: "Autant que vous voulez pour la capture et l'aperçu. La limite porte sur le téléchargement : une image gratuite par jour en basse résolution, et chaque image en pleine résolution coûte 1 crédit. Chaque compte reçoit 2 crédits gratuits par jour.",
        },
        {
          q: "Quelle est la résolution de l'image exportée ?",
          a: "Un téléchargement en pleine résolution est un PNG à la résolution native de la vidéo. Le téléchargement gratuit quotidien est réduit à environ 0,25 mégapixel.",
        },
        {
          q: "Et si je veux monter toute la vidéo ?",
          a: "Cet outil enregistre une seule image fixe. Pour couper, sous-titrer ou réorganiser tout le clip, utilisez l'éditeur vidéo gratuit de WipeClip.co pour Windows et Mac.",
        },
      ],
    },
  },
  es: {
    "": {
      enPath: "/download",
      demo: "download",
      title: "Grabador de pantalla y editor de vídeo gratis para Windows y Mac",
      description:
        "Graba tu pantalla, corta las pausas con un clic y añade zooms automáticos y subtítulos. Gratis para Windows y macOS.",
      badge: "Gratis para Windows y Mac",
      h1: ["Graba tu pantalla y ", "edita tus vídeos", " gratis"],
      intro:
        "WipeClip es un grabador de pantalla y editor de vídeo gratis para Windows y Mac. Los zooms siguen automáticamente cada clic, las pausas se cortan con un clic y los subtítulos se generan en tu propio ordenador.",
      guideTitle: "Cómo crear un vídeo con WipeClip",
      steps: [
        "Descarga WipeClip para Windows o macOS e instala la aplicación.",
        "Graba toda la pantalla, una ventana o un área. El audio del sistema, el micrófono y la webcam se guardan en pistas separadas.",
        "Acepta los zooms sugeridos sobre tus clics o ajústalos.",
        "Corta las pausas largas y los tiempos muertos, y genera subtítulos en tu propio ordenador.",
        "Exporta un MP4 y los subtítulos (.srt o .vtt) directamente a tu disco.",
      ],
      facts: [
        { label: "Sistemas", value: "Windows 10 (21H2+), Windows 11, macOS 11+" },
        { label: "Precio", value: "Gratis, pases opcionales sin suscripción" },
        { label: "Grabación", value: "Pantalla, ventana o área" },
        { label: "Subtítulos", value: "Generados en el equipo, .srt y .vtt" },
        { label: "Formatos", value: "Horizontal, vertical, cuadrado" },
      ],
      faqTitle: "Preguntas frecuentes sobre WipeClip",
      faqs: [
        {
          q: "¿WipeClip es gratis?",
          a: "Sí. Descargar, grabar y editar es gratis. Al iniciar sesión obtienes exportaciones a resolución completa, que usan créditos. Recibes créditos gratis cada día, y los pases opcionales sin suscripción desbloquean efectos premium y 4K.",
        },
        {
          q: "¿Qué sistemas son compatibles?",
          a: "Windows 10 (21H2 o posterior), Windows 11 y macOS 11 o posterior.",
        },
        {
          q: "¿Se suben mis grabaciones?",
          a: "No. Las grabaciones se guardan en una carpeta de tu ordenador, y la grabación, la edición, el análisis y los subtítulos ocurren ahí. Un vídeo solo se sube al exportar, se procesa en almacenamiento temporal y no se conserva.",
        },
        {
          q: "¿Por qué Windows muestra «Windows protegió su PC»?",
          a: "Windows avisa con las aplicaciones nuevas que aún tienen pocas descargas. En el instalador, haz clic en «Más información» y luego en «Ejecutar de todas formas». Una vez instalada, la aplicación se actualiza sola.",
        },
        {
          q: "¿En qué idioma está la aplicación?",
          a: "Por ahora, la interfaz de la aplicación está en inglés.",
        },
      ],
    },
    "quitar-fondo": {
      enPath: "/remove-background",
      demo: "background",
      title: "Quitar el fondo de una imagen gratis – PNG transparente",
      description:
        "Sube una foto y obtén un PNG con fondo transparente en segundos. Un resultado gratis al día, sin cuenta.",
      badge: "Herramienta gratis",
      h1: ["Quita el ", "fondo", " de cualquier foto"],
      intro:
        "Sube una foto y recibe un PNG transparente. Nada que marcar y sin cuenta para la vista previa. Coloca el sujeto sobre el fondo que necesites.",
      guideTitle: "Cómo quitar el fondo de una foto",
      steps: [
        "Arrastra una foto JPG, PNG o WebP (hasta 25 MB) a la zona de subida, o haz clic para elegir un archivo.",
        "WipeClip detecta el sujeto automáticamente. No hay que trazar ni marcar nada.",
        "Revisa el recorte en la vista previa sobre el fondo de cuadros transparente.",
        "Descarga el resultado como PNG con fondo transparente y colócalo sobre un fondo nuevo.",
      ],
      facts: [
        { label: "Salida", value: "PNG con transparencia" },
        { label: "Subida máx.", value: "25 MB por imagen" },
        { label: "Gratis", value: "1 recorte al día, tamaño reducido" },
        { label: "Con sesión", value: "Resolución completa, 1 crédito por imagen" },
        { label: "Créditos gratis", value: "2 al día, en cada cuenta" },
      ],
      faqTitle: "Quitar fondo: preguntas frecuentes",
      faqs: [
        {
          q: "¿De verdad es gratis?",
          a: "Sí. Todo el mundo tiene un recorte gratis al día a tamaño reducido, sin cuenta. Para la resolución completa, inicia sesión: cuesta 1 crédito, y cada cuenta recibe 2 créditos gratis al día.",
        },
        {
          q: "¿Qué formato de archivo obtengo?",
          a: "Un PNG con canal alfa transparente, para poner el sujeto directamente sobre un fondo nuevo, una ficha de producto o una diapositiva.",
        },
        {
          q: "¿Sirve para fotos de producto?",
          a: "Sí. El PNG recortado se puede poner sobre un fondo blanco o de color, como piden muchos marketplaces y tiendas online para las fotos de producto.",
        },
        {
          q: "¿Los bordes del pelo o de los detalles finos quedan bien?",
          a: "Tras el primer recorte, WipeClip limpia los bordes y suaviza el canal alfa para eliminar halos y contornos irregulares en los detalles finos.",
        },
        {
          q: "¿Guardáis mi foto?",
          a: "No. La foto se procesa para crear tu PNG y después se elimina. Nunca se usa para entrenar ningún modelo.",
        },
      ],
    },
    "enfocar-foto": {
      enPath: "/sharpen-image",
      demo: "sharpen",
      title: "Enfocar una foto borrosa gratis",
      description:
        "Devuelve el detalle a una foto suave o un poco borrosa en segundos. Un resultado gratis al día, sin cuenta. Intensidad ligera, estándar o fuerte.",
      badge: "Herramienta gratis",
      h1: ["Enfoca una foto ", "suave o borrosa", ""],
      intro: "Sube una foto, elige la intensidad y recupera detalles más nítidos, sin cuenta para la vista previa.",
      guideTitle: "Cómo enfocar una foto suave",
      steps: [
        "Arrastra una foto JPG, PNG o WebP (hasta 25 MB) a la zona de subida, o haz clic para elegir un archivo.",
        "Elige una intensidad: Light para piel y cielo, Standard para la mayoría de fotos, Strong para fotos que siguen viéndose suaves.",
        "Compara el resultado con el original lado a lado.",
        "Descarga la foto enfocada. Mantiene las dimensiones en píxeles de tu subida.",
      ],
      facts: [
        { label: "Intensidades", value: "Light, Standard, Strong" },
        { label: "Subida máx.", value: "25 MB por imagen" },
        { label: "Gratis", value: "1 foto al día, tamaño reducido" },
        { label: "Resolución completa", value: "1 crédito por foto, 2 créditos gratis al día" },
      ],
      faqTitle: "Enfocar fotos: preguntas frecuentes",
      faqs: [
        {
          q: "¿Arregla una foto muy borrosa o movida?",
          a: "No. La herramienta recupera el contraste local y el detalle de los bordes en una foto que ya es bastante nítida pero se ve un poco suave, por ejemplo tras comprimirla o reducirla. No puede inventar detalles que nunca se captaron.",
        },
        {
          q: "¿Aumenta la resolución de la imagen?",
          a: "No. El resultado tiene las mismas dimensiones en píxeles que tu subida. La herramienta mejora la claridad a la misma resolución.",
        },
        {
          q: "¿Qué diferencia hay entre Light, Standard y Strong?",
          a: "Cuánto se refuerza el contraste local alrededor de los bordes detectados. Standard va bien con la mayoría de fotos, Light evita el exceso en piel o cielo, y Strong es para fotos que siguen suaves tras Standard.",
        },
        {
          q: "¿Es gratis?",
          a: "Sí. Todo el mundo tiene una foto enfocada gratis al día a tamaño reducido, sin cuenta. Para la resolución completa, inicia sesión: cuesta 1 crédito, y cada cuenta recibe 2 créditos gratis al día.",
        },
        {
          q: "¿Guardáis mi foto?",
          a: "No. La foto se procesa y después se elimina. Nunca se usa para entrenar ningún modelo.",
        },
      ],
    },
    "extraer-fotograma-video": {
      enPath: "/extract-video-frame",
      demo: "frame",
      title: "Extraer un fotograma de un vídeo gratis, sin subirlo",
      description:
        "Guarda cualquier fotograma de un vídeo como captura o miniatura en PNG. Funciona en tu navegador, sin subir nada. Una descarga gratis al día.",
      badge: "Gratis • Sin subidas",
      h1: ["Extrae un ", "fotograma", " de cualquier vídeo"],
      intro:
        "Ve al momento que quieras y guárdalo como PNG, hasta la resolución completa. Todo ocurre en tu navegador. Tu vídeo nunca se sube.",
      guideTitle: "Cómo guardar un fotograma de un vídeo",
      steps: [
        "Abre un vídeo que tu navegador pueda reproducir (MP4 o WebM, hasta 500 MB). Se queda en tu dispositivo.",
        "Ve al momento que quieras o elige una de las portadas que WipeClip sugiere al analizar el vídeo.",
        "Captura el fotograma. Puedes capturar tantos como quieras.",
        "Descarga un fotograma gratis a tamaño reducido una vez al día, o a resolución completa por 1 crédito.",
      ],
      facts: [
        { label: "Salida", value: "PNG, hasta la resolución del vídeo" },
        { label: "Tamaño máx.", value: "500 MB" },
        { label: "Subida", value: "Ninguna, funciona en el navegador" },
        { label: "Gratis", value: "1 descarga al día, baja resolución" },
        { label: "Resolución completa", value: "1 crédito por fotograma, requiere sesión" },
      ],
      faqTitle: "Extraer fotogramas: preguntas frecuentes",
      faqs: [
        {
          q: "¿Mi vídeo se sube a algún sitio?",
          a: "No. El vídeo se decodifica y se dibuja por completo en la pestaña de tu navegador, y nunca se envía a los servidores de WipeClip.co. Funcionan vídeos de hasta 500 MB en un formato que tu navegador pueda reproducir (normalmente MP4 o WebM).",
        },
        {
          q: "¿Cuántos fotogramas puedo capturar?",
          a: "Todos los que quieras para capturar y previsualizar. El límite está en la descarga: un fotograma gratis al día en baja resolución, y cada fotograma a resolución completa cuesta 1 crédito. Cada cuenta recibe 2 créditos gratis al día.",
        },
        {
          q: "¿Qué resolución tiene el fotograma exportado?",
          a: "Una descarga a resolución completa es un PNG a la resolución nativa del vídeo. La descarga gratis diaria se reduce a unos 0,25 megapíxeles.",
        },
        {
          q: "¿Y si quiero editar todo el vídeo?",
          a: "Esta herramienta guarda un solo fotograma. Para cortar, subtitular o reordenar todo el clip, usa el editor de vídeo gratis de WipeClip.co para Windows y Mac.",
        },
      ],
    },
  },
};
