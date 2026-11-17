/** English words in Indic-script captions, written back in English.
 *
 * People speaking Sinhala, Tamil, Hindi and the other Indic languages mix in
 * English words ("video", "link", "click", "download"). The speech models
 * write some of them in English, but most come out spelled in the
 * language's own script: "ෆෝන්" for phone, "ලින්ක්" for link,
 * "ස්ක්‍රීන්" for screen (the Sinhala model on synthesized English).
 *
 * Each word in a Brahmic script is romanized and compared by sound with a
 * list of English words that are commonly said in those languages (and the
 * Latin-script words of the names hint). A close enough match replaces it.
 * Whole words are replaced; in Sinhala, so is a loanword with a common
 * ending joined on ("වීඩියෝවක්", "a video", becomes "video එකක්").
 *
 * Pure (no model), so it is tested on its own: tests/desktop/englishWords.test.ts. */

// --- Romanizing ---------------------------------------------------------------

/** Consonants of the Unicode blocks laid out like Devanagari (Devanagari,
 * Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam),
 * by offset 0x15-0x39 in the block. Retroflex and dental are not told apart. */
const CONSONANTS = [
  "k", "kh", "g", "gh", "n", "c", "ch", "j", "jh", "ny",
  "t", "th", "d", "dh", "n", "t", "th", "d", "dh", "n",
  "n", "p", "ph", "b", "bh", "m", "y", "r", "r", "l",
  "l", "l", "v", "sh", "sh", "s", "h",
];
/** Offsets 0x58-0x5F: consonants with a nukta, precomposed. */
const NUKTA_CONSONANTS = ["k", "kh", "g", "z", "r", "r", "f", "y"];
/** Independent vowels, offsets 0x05-0x14. */
const VOWELS = ["a", "aa", "i", "ii", "u", "uu", "ri", "li", "e", "e", "ee", "ai", "o", "o", "oo", "au"];
/** Vowel signs, offsets 0x3E-0x4C. */
const VOWEL_SIGNS = ["aa", "i", "ii", "u", "uu", "ri", "rii", "e", "e", "ee", "ai", "o", "o", "oo", "au"];
/** Malayalam chillu letters (a consonant with no vowel), offsets 0x7A-0x7F. */
const CHILLUS = ["n", "n", "r", "l", "l", "k"];

const SINHALA_CONSONANTS: Record<number, string> = {
  0x0d9a: "k", 0x0d9b: "kh", 0x0d9c: "g", 0x0d9d: "gh", 0x0d9e: "ng", 0x0d9f: "ng",
  0x0da0: "c", 0x0da1: "ch", 0x0da2: "j", 0x0da3: "jh", 0x0da4: "ny", 0x0da5: "gn", 0x0da6: "nj",
  0x0da7: "t", 0x0da8: "th", 0x0da9: "d", 0x0daa: "dh", 0x0dab: "n", 0x0dac: "nd",
  0x0dad: "t", 0x0dae: "th", 0x0daf: "d", 0x0db0: "dh", 0x0db1: "n", 0x0db3: "nd",
  0x0db4: "p", 0x0db5: "ph", 0x0db6: "b", 0x0db7: "bh", 0x0db8: "m", 0x0db9: "mb",
  0x0dba: "y", 0x0dbb: "r", 0x0dbd: "l", 0x0dc0: "v", 0x0dc1: "sh", 0x0dc2: "sh",
  0x0dc3: "s", 0x0dc4: "h", 0x0dc5: "l", 0x0dc6: "f",
};
const SINHALA_VOWELS: Record<number, string> = {
  0x0d85: "a", 0x0d86: "aa", 0x0d87: "ae", 0x0d88: "ae", 0x0d89: "i", 0x0d8a: "ii",
  0x0d8b: "u", 0x0d8c: "uu", 0x0d8d: "ri", 0x0d8e: "ri", 0x0d8f: "li", 0x0d90: "li",
  0x0d91: "e", 0x0d92: "ee", 0x0d93: "ai", 0x0d94: "o", 0x0d95: "oo", 0x0d96: "au",
};
const SINHALA_SIGNS: Record<number, string> = {
  0x0dcf: "aa", 0x0dd0: "ae", 0x0dd1: "ae", 0x0dd2: "i", 0x0dd3: "ii", 0x0dd4: "u",
  0x0dd6: "uu", 0x0dd8: "ru", 0x0dd9: "e", 0x0dda: "ee", 0x0ddb: "ai", 0x0ddc: "o",
  0x0ddd: "oo", 0x0dde: "au", 0x0ddf: "lu", 0x0df2: "ruu", 0x0df3: "luu",
};
const SINHALA_VIRAMA = 0x0dca;

type Script = "sinhala" | "devanagari" | "bengali" | "gurmukhi" | "gujarati" | "oriya" | "tamil" | "telugu" | "kannada" | "malayalam";
const BLOCKS: Script[] = ["devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil", "telugu", "kannada", "malayalam"];
/** The unwritten last vowel isn't said in these. */
const SCHWA: Script[] = ["devanagari", "bengali", "gurmukhi", "gujarati"];
/** Native words rarely end without a vowel in these, loanwords often do. In
 * Tamil and Malayalam many native words do (கல், വർഷം). */
const BARE_END_LOAN: Script[] = ["sinhala", "telugu", "kannada", "oriya"];

export interface Romanized {
  /** The word in Latin letters, with each unwritten vowel as "a". */
  text: string;
  /** Hindi, Bengali, Gujarati, Punjabi: without the last unwritten vowel,
   * which isn't said there ("कर" is "kar"). Compared instead of `text`. */
  clipped?: string;
  script: Script;
  /** Spelled the way loanwords are: ending without a vowel (Sinhala,
   * Telugu, Kannada, Oriya; Tamil on a stop), or with a letter used mostly for English
   * sounds (f in Sinhala, Telugu, Kannada, Malayalam; Devanagari ॉ ॅ ज़
   * फ़; Tamil ஃ and the Grantha letters). Short words must have one. */
  loanLike: boolean;
}

function scriptOf(cp: number): Script | null {
  if (cp >= 0x0d80 && cp <= 0x0dff) return "sinhala";
  if (cp >= 0x0900 && cp <= 0x0d7f) return BLOCKS[(cp - 0x0900) >> 7];
  return null;
}

/** Letters used mostly for English (and other borrowed) sounds, by block
 * offset: ఫ ಫ ഫ (f), Tamil ஜ ஷ ஸ ஹ. */
const LOAN_LETTERS: Partial<Record<Script, number[]>> = {
  telugu: [0x2b],
  kannada: [0x2b],
  malayalam: [0x2b],
  tamil: [0x1c, 0x37, 0x38, 0x39],
};

/** `word` in Latin letters, or null when it isn't all one Brahmic script
 * (marks and joiners aside). */
export function romanize(word: string): Romanized | null {
  let script: Script | null = null;
  let out = "";
  let inherent = false; // a consonant waiting for its vowel
  let loanLike = false;
  let endsBare = false; // ends on a consonant with no vowel
  let aytham = false; // Tamil ஃ: the next ப is f, ஜ is z
  const flush = () => {
    if (inherent) out += "a";
    inherent = false;
  };
  const consonant = (c: string) => {
    flush();
    if (aytham) {
      c = c === "p" || c === "ph" ? "f" : c === "j" ? "z" : c;
      aytham = false;
    }
    out += c;
    inherent = true;
    endsBare = false;
  };
  const vowel = (v: string) => {
    flush();
    out += v;
    endsBare = false;
  };
  const sign = (v: string) => {
    inherent = false;
    out += v;
    endsBare = false;
  };
  const virama = () => {
    inherent = false;
    endsBare = true;
  };
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200c || cp === 0x200d) continue; // joiners (Sinhala ් + ZWJ + ර)
    const s = scriptOf(cp);
    if (!s) return null;
    if (script && s !== script) return null;
    script = s;
    if (s === "sinhala") {
      if (SINHALA_CONSONANTS[cp]) {
        consonant(SINHALA_CONSONANTS[cp]);
        if (cp === 0x0dc6) loanLike = true;
      } else if (SINHALA_VOWELS[cp]) vowel(SINHALA_VOWELS[cp]);
      else if (SINHALA_SIGNS[cp]) sign(SINHALA_SIGNS[cp]);
      else if (cp === SINHALA_VIRAMA) virama();
      else if (cp === 0x0d82) vowel("n");
      else if (cp === 0x0d83) vowel("h");
      else if (cp >= 0x0de6 && cp <= 0x0def) return null; // digits
      continue;
    }
    const base = cp & ~0x7f;
    const off = cp - base;
    const devanagari = base === 0x0900;
    if (off >= 0x15 && off <= 0x39) {
      consonant(CONSONANTS[off - 0x15]);
      if (LOAN_LETTERS[s]?.includes(off)) loanLike = true;
    }
    else if (off >= 0x58 && off <= 0x5f) {
      consonant(NUKTA_CONSONANTS[off - 0x58]);
      if (devanagari && (off === 0x5b || off === 0x5e)) loanLike = true; // ज़ फ़
    } else if (off >= 0x05 && off <= 0x14) {
      vowel(devanagari && off === 0x10 ? "ae" : VOWELS[off - 0x05]);
      if (devanagari && (off === 0x0d || off === 0x11)) loanLike = true; // ऍ ऑ
    } else if (off >= 0x3e && off <= 0x4c) {
      // Hindi ै is said like the a in "app" (लैपटॉप, laptop).
      sign(devanagari && off === 0x48 ? "ae" : VOWEL_SIGNS[off - 0x3e]);
      if (devanagari && (off === 0x45 || off === 0x49)) loanLike = true; // ॅ ॉ
    } else if (off === 0x4d) virama();
    else if (off === 0x3c) {
      // Nukta: फ़ is f, ज़ is z (English sounds), ड़ is r (a Hindi one).
      const before = out;
      out = out.replace(/ph$/, "f").replace(/j$/, "z");
      if (devanagari && out !== before) loanLike = true;
      out = out.replace(/dh?$/, "r");
    } else if (off === 0x03 && s === "tamil") {
      flush();
      aytham = true;
      loanLike = true;
    } else if (off === 0x01 || off === 0x02 || (off === 0x70 && base === 0x0a00)) vowel("n"); // anusvara, candrabindu, tippi
    else if (off === 0x03) vowel("h");
    else if (off === 0x4e && base === 0x0980) {
      // Bengali khanda ta: t with no vowel.
      consonant("t");
      virama();
    } else if (off >= 0x7a && off <= 0x7f && base === 0x0d00) {
      consonant(CHILLUS[off - 0x7a]);
      virama();
    } else if (off >= 0x66 && off <= 0x6f) return null; // digits
    else if (off === 0x60 || off === 0x61) vowel(off === 0x60 ? "ri" : "li");
    else if (off === 0x62 || off === 0x63) sign("li");
    // Anything else (length marks, addak, avagraha) adds no sound here.
  }
  if (!script || !out) return null;
  const clipped = SCHWA.includes(script) && inherent ? out : undefined;
  flush();
  if (endsBare && BARE_END_LOAN.includes(script)) loanLike = true;
  // Tamil words end in a nasal, l, r or y, never a stop: லிங்க் (link), டெஸ்ட் (test).
  if (endsBare && script === "tamil" && /[kctp]$/.test(out)) loanLike = true;
  return { text: out, clipped: clipped && clipped !== out ? clipped : undefined, script, loanLike };
}

// --- Comparing by sound -------------------------------------------------------

/** Letters reduced to how they sound, the same way for a romanized word and
 * a spoken form: aspiration dropped (kh = k), sh = s, w = v, ng = n, long
 * vowels short, doubled letters single, "ae" = "a", n before p/b = m. */
export function soundKey(s: string): string {
  let k = s.toLowerCase().replace(/[^a-z]/g, "");
  k = k
    .replace(/ph/g, "f")
    .replace(/([kgcjtdb])h/g, "$1")
    .replace(/sh/g, "s")
    .replace(/ck/g, "k")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/ng/g, "n")
    .replace(/ae/g, "a")
    .replace(/n(?=[pb])/g, "m")
    .replace(/([aeiou])vu/g, "$1u")
    .replace(/(.)\1+/g, "$1");
  return k;
}

const isVowel = (c: string) => "aeiou".includes(c);
/** Consonants close enough to swap cheaply: the sounds the scripts write
 * alike (Bengali ব for b and v, Tamil ப for p and f, z written as s or
 * j). Voiced and voiceless (podi, "party") are told apart but in Tamil. */
const NEAR = new Set(["sz", "jz", "vb", "fp", "cs", "yi", "vu"].flatMap((p) => [p, p[1] + p[0]]));
/** Tamil writes k/g, t/d, p/b and c/j with one letter each. */
const TAMIL_SAME = new Set(["kg", "td", "pb", "cj"].flatMap((p) => [p, p[1] + p[0]]));
/** Letters that come and go between spellings at little cost: y and v
 * glides, h (aspiration, visarga). */
const SOFT = "yvh";

/** Vowels that loanword spellings swap: a for the a in "app" or the o in
 * "hot" (Bengali অ), e for i, o for u. Other vowel changes cost 1.5:
 * तितली (butterfly, "titali") isn't "totally". */
const NEAR_VOWELS = new Set(["ae", "ao", "ei", "ou"].flatMap((p) => [p, p[1] + p[0]]));

/** Weighted edit distance: a vowel added or left out, a near vowel or a
 * near consonant costs 0.5, another vowel 1.5, any other consonant `hard`. */
export function soundDistance(a: string, b: string, hard: number, tamil = false): number {
  const indel = (c: string) => (isVowel(c) || SOFT.includes(c) ? 0.5 : hard);
  const sub = (x: string, y: string) => {
    if (x === y) return 0;
    if (isVowel(x) && isVowel(y)) return NEAR_VOWELS.has(x + y) ? 0.5 : 1.5;
    if (tamil && TAMIL_SAME.has(x + y)) return 0;
    if (NEAR.has(x + y)) return 0.5;
    return Math.max(hard, indel(x) + indel(y));
  };
  let prev = [0];
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + indel(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    const row = [prev[0] + indel(a[i - 1])];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + indel(a[i - 1]), row[j - 1] + indel(b[j - 1]), prev[j - 1] + sub(a[i - 1], b[j - 1]));
    prev = row;
  }
  return prev[b.length];
}

// --- The English words ------------------------------------------------------

/** English words often said in Indic-language speech, each with how it's
 * said there when the spelling doesn't show it ("phone=fon"). Kept to
 * words that don't sound like common native words: "car" and "bus" are
 * Hindi कर (do) and बस (enough), so they are only matched when spelled like
 * a loanword (see Romanized.loanLike). */
const LOANWORDS = `
video=vidiyo videos=vidiyos audio=odiyo phone=fon mobile=mobail smartphone=smatfon laptop computer=kompyutar
keyboard=kibod mouse=maus screen=skrin screenshot=skrinsot camera=kemara mic=maik microphone=maikrofon
speaker=spikar headphones=hedfons headset=hedset earphones=iyafons charger=cajar battery=batari cable=kebal
WiFi=vaifai Bluetooth=blutut internet=intanet network=netvok data=deta online=onlain offline=oflain
website=vebsait link links email=imel message=mesej messages=mesejas chat=cat call=kol app=ap apps=aps
software=softveyar hardware=hadveyar system=sistam server=sarvar account=akaunt password=pasvad login logout=logaut
profile=profail page=pej group=grup file=fail files=fails folder=foldar download=daunlod upload=aplod
install=instol update=apdet version=varsan settings=setins setting=setin click=klik button=batan menu=menu
option=opsan options=opsans select=selekt copy=kopi paste=pest delete=dilit edit editing=editin editor=editar
save=sev cut=kat trim crop=krop zoom=zum filter=filtar effect=efekt effects=efekts transition=transisan
caption=kepsan captions=kepsans subtitle=sabtaital subtitles=sabtaitals text=tekst font color=kalar
background=bekgraund template=templet layer=leyar timeline=taimlain frame=frem clip=klip clips=klips
project=projekt export=eksport import render=rendar preview=privyu play=ple pause=pos stop start finish=finis
next=nekst slide=slaid slides=slaids photo=foto photos=fotos picture=pikcar image=imej design=disain
graphic=grafik graphics=grafiks animation=animesan music=myusik sound=saund voice=vois volume=volyum
record=rekod recording=rekodin live=laiv stream=strim channel=canal subscribe=sabskraib like=laik
comment=koment comments=koments share=seyar follow=folo followers=folovars post=post story=stori
view=vyu views=vyus trend trending=trendin viral=vairal content=kontent creator=kriyetar tutorial=tyutoriyal
lesson=lesan course=kos class=klas school=skul university=yunivasiti campus=kampas teacher=ticar
student=styudant exam=eksam test paper=pepar book=buk notes=nots homework=homvak assignment=asainmant
office=ofis meeting=mitin manager=manejar company=kampani business=bisnas job salary=salari bank=benk
card=kad cash=kas price=prais shop=sop market=maket order=odar delivery=delivari product=prodakt
service=sarvis customer=kastamar client=klayant team=tim plan=plen idea=aidiya problem=problam
solution=solusan point=point topic=topik example=egsampal question=kvescan answer=ansar result=risalt
process=proses step=step method=metad type=taip level=leval quality=kvaliti size=sais number=nambar list
simple=simpal easy=isi best nice=nais super=supar perfect=parfekt special=spesal normal=nomal
different=difarant free=fri basic=besik extra=ekstra actually=ekcuvali basically=besikali really=riyali
exactly=egzektli totally=totali sorry=sori thanks=tenks thank=tenk please=plis welcome=velkam hello=helo
bye=bai okay=oke bus=bas car=kar train=tren bike=baik road=rod hotel=hotal hospital doctor=doktar
room=rum city=siti town=taun station=stesan park=pak ticket=tikat time=taim minute=minit minutes=minits
week=vik weekend=vikend date=det birthday=bartde party=pati game=gem games=gems match=mec cricket=kriket
football=futbol gym=jim movie=muvi film series=siris episode=episod cake=kek pizza=pisa coffee=kofi
chocolate=cokalet juice=jus lunch=lanc dinner=dinar breakfast=brekfast police=polis shooting=sutin
label=lebal November=navambar miss=mis shot=sat cheese=cis sheet=sit jet looking=lukin kiss=kis
base=bes boys=bays father=fadar boost=bust code=kod top=tap fly=flai lock=lak pass=pas west=vest move=muv
cool=kul push=pus love=lav think=tink sit soup=sup wash=vas case=kes keys=kis rod leak=lik
mine=main men kick=kik store=stor coat=kot off=af intent chair=ceyar fund=fand form=fom farm=fam fan=fen
expert=ekspat sweet=svit star guys=gais hell=hel look=luk fine=fain fun=fan south=saut set pack=pyak mean=min
shoot=sut shooter=sutar site=sait tape=tep pen
web=veb concept=konsept center=sentar ayurvedic=ayurvedik digital=dijital marketing=maketin brand=brend
logo=logo social=sosal media=midiya New_Zealand=nyusilan Australia=ostreliya Canada=kanada
`;

interface Candidate {
  word: string;
  key: string;
}

function candidates(list: string): Candidate[] {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .map((e) => {
      const [word, spoken] = e.split("=");
      return { word: word.replace(/_/g, " "), key: soundKey(spoken ?? word) };
    });
}

const BUILT_IN = candidates(LOANWORDS);

/** Common native words that sound like one of the English words above. */
const NATIVE = new Set(
  `
වරල
केवल कमरा कमरे वर्षों अनुसार सत्संग अक्षम लगीं कंपन सियार सर्वेयर तितली दीनार
बातें बातों बताएँ बताऊँ बताएं बताऊं बतांए बैठें कांपना फ़ल
நண்பர் ஃபக் அடைய கப்பல் ஜன்னல் ஜன்னல நம்மால் எடுத்தார் சொன்னால் விளக்கம் வழக்கம் சாம்பல் விரல் விரல வரல
வாய்ப்பை ஷிட் சிரிச்சே திசையன் பாத்தேன் திணறி செய்யற விதியை பட்டார் சுட்டேன் கஸ்
ఫక్ షిట్ వారాల వారాలు ఈస్ మక్ టామ్ రోమ్ కోర్ బస్ట్ శాండ్ మీథేన్ హేల్ టిమ్ ఫాల్స్ ప్లేఇన్ కాక్ రాయాలి కేట్
వాస్ పస్ డెత్ దట్ డాట్ కంప్స్ బక్ ఆఫ్స్ అఫ్ వర్షం తోటలో బాడ్ మాన్ విక్ వేక్ స్వాత్
നമ്മള് നമ്മൾ വർഷം വര്ഷം വർഷവും എന്താണിത് എന്താണത് ഷങ്ങള് വട്ടം വട്ടാണ് വതം ആകുന്നത് ഫാല് തൊട്ടാല്
വിരല് വിരൽ വരല്ലേ വിധിയെ
ভেতরে ভেতরেই ভিতরে কেবল দিনের শালার শালারা খেলার খোলার কালের বেতন টিকতে কামড়ে অক্ষম কাঁপছে
`
    .split(/\s+/)
    .filter(Boolean)
);

/** How far a word may sound from an English one for its sound key length:
 * up to 5 letters, one vowel or near consonant off (in Tamil, up to 4, not
 * at all: one letter each for k/g, t/d, p/b already makes பட், "but", sound
 * like "party"); up to 8, two; from 9, three, or one other consonant and a
 * vowel. Looser let in native words: වතුර (water) as "battery", පොත (book)
 * as "photo", मन (mind) as "menu". */
function allowance(n: number, tamil: boolean): { max: number; hard: number } {
  if (n <= 4 && tamil) return { max: 0, hard: 2 };
  if (n <= 5) return { max: 0.5, hard: 2 };
  if (n <= 8) return { max: 1, hard: 2 };
  return { max: 1.5, hard: 1 };
}

function firstSoundsAlike(a: string, b: string, tamil: boolean): boolean {
  if (a === b) return true;
  if (isVowel(a) && isVowel(b)) return true;
  return NEAR.has(a + b) || (tamil && TAMIL_SAME.has(a + b));
}

/** The English word `word` (one word in a Brahmic script, no punctuation)
 * sounds like, or null. */
export function englishFor(word: string, extra: Candidate[] = []): string | null {
  // Composed, so a vowel typed in two parts (Tamil ெ + ா for ொ) reads as one.
  word = word.normalize("NFC");
  const r = romanize(word);
  if (!r) return null;
  if (NATIVE.has(word)) return null;
  const tamil = r.script === "tamil";
  const k = soundKey(r.clipped ?? r.text);
  if (k.length < 2) return null;
  let best: string | null = null;
  let bestD = Infinity;
  let bestLen = Infinity;
  for (const c of [...extra, ...BUILT_IN]) {
    if (c.key.length < 2) continue;
    // By the shorter of the two: Tamil வீடு (house, "vidu") is three
    // vowel changes from "vidiyo", too many for a 4-letter word.
    const n = Math.min(k.length, c.key.length);
    if ((n <= 4 && !r.loanLike) || Math.abs(k.length - c.key.length) > 3 || !firstSoundsAlike(k[0], c.key[0], tamil)) continue;
    const { max, hard } = allowance(n, tamil);
    // A last vowel the English word doesn't end with is mostly a native
    // ending (बताना, "to tell", isn't "button"; মিনিটে is "in a minute").
    const d = soundDistance(k, c.key, hard, tamil) + (isVowel(k[k.length - 1]) && !isVowel(c.key[c.key.length - 1]) ? 0.5 : 0);
    // A tie goes to the word of the closer length (பாதர், "father", not "battery").
    const len = Math.abs(k.length - c.key.length);
    if (d <= max && (d < bestD || (d === bestD && len < bestLen))) {
      best = c.word;
      bestD = d;
      bestLen = len;
    }
  }
  return best;
}

/** Sinhala endings joined onto a loanword, longest first, with how they're
 * written after an English word: "වීඩියෝවක්" (a video) is "video එකක්",
 * "ෆෝන්එකේ" (in the phone) "phone එකේ". After a vowel the ending starts
 * with ව, after a consonant with එ. The plural වල ("in", "of the")
 * follows either: "නිව්සිලන්වල" is "New Zealand වල". */
const SINHALA_ENDINGS: [string, string][] = [
  ["වලින්", "වලින්"], ["වලට", "වලට"], ["වල", "වල"],
  ["වකට", "එකකට"], ["වකින්", "එකකින්"], ["වෙන්", "එකෙන්"], ["වක්", "එකක්"], ["වටත්", "එකටත්"], ["වට", "එකට"],
  ["වත්", "එකත්"], ["වේ", "එකේ"], ["ව", "එක"],
  ["එකකට", "එකකට"], ["එකකින්", "එකකින්"], ["එකෙන්", "එකෙන්"], ["එකක්", "එකක්"], ["එකටත්", "එකටත්"], ["එකට", "එකට"],
  ["එකත්", "එකත්"], ["එකේ", "එකේ"], ["එක", "එක"],
];
const SINHALA_VOWEL_SIGN = /[ා-ෟෲෳ]$/u;

/** A Sinhala word that is an English word with an ending joined on, as
 * the English word and the ending ("වීඩියෝවක්" -> "video එකක්"), or null.
 * The part before the ending has to be a whole, long enough loanword. */
function englishWithEnding(word: string, extra: Candidate[]): string | null {
  word = word.normalize("NFC");
  for (const [ending, written] of SINHALA_ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    // ව follows a vowel sign (වීඩියෝ+ව); එ follows a bare consonant
    // (ෆෝන්+එක); වල follows either.
    const vowelEnd = SINHALA_VOWEL_SIGN.test(stem);
    const bareEnd = stem.endsWith("්");
    const fits = ending.startsWith("වල") ? vowelEnd || bareEnd : ending.startsWith("ව") ? vowelEnd : bareEnd;
    if (!fits) continue;
    const r = romanize(stem);
    // වල ends many native nouns too (ගම්වල, "in villages", isn't "game"),
    // so before it only a longer word counts.
    if (!r || r.script !== "sinhala" || soundKey(r.text).length < (ending.startsWith("වල") ? 5 : 3)) continue;
    const en = englishFor(stem, extra);
    if (en) return `${en} ${written}`;
  }
  return null;
}

export interface TextWord {
  text: string;
}

/** `words` with each Indic-script word that sounds like an English one
 * (built-in loanwords and the Latin-script words of `hint`) written in
 * English. Punctuation around a word is kept. */
export function keepEnglish<T extends TextWord>(words: T[], hint = ""): T[] {
  const extra = candidates(
    hint
      .split(/[\s,;]+/)
      .filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t))
      .join(" ")
      .replace(/=/g, "")
  );
  const seen = new Map<string, string | null>();
  return words.map((w) => {
    const m = /^(\p{P}*)(.*?)(\p{P}*)$/u.exec(w.text);
    if (!m || !m[2] || /[A-Za-z0-9]/.test(m[2])) return w;
    let en = seen.get(m[2]);
    if (en === undefined) {
      en = englishFor(m[2], extra) ?? englishWithEnding(m[2], extra);
      seen.set(m[2], en);
    }
    return en ? { ...w, text: `${m[1]}${en}${m[3]}` } : w;
  });
}
