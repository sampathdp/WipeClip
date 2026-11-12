// Run with: npm run desktop:test:js
// English words in Indic-script captions written back in English (src/lib/editor/englishWords.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { englishFor, keepEnglish, romanize } from "../../src/lib/editor/englishWords.ts";

test("romanizes Sinhala, Devanagari and Tamil", () => {
  assert.equal(romanize("ෆෝන්")?.text, "foon");
  assert.equal(romanize("ස්ක්‍රීන්")?.text, "skriin");
  assert.equal(romanize("ලින්ක්")?.loanLike, true);
  assert.equal(romanize("मीटिंग")?.clipped, "miiting");
  assert.equal(romanize("फ़ोन")?.text, "foona");
  assert.equal(romanize("ஃபோன்")?.text, "foon");
  assert.equal(romanize("video"), null);
  assert.equal(romanize("ෆෝන්phone"), null);
});

test("finds English loanwords spelled in the language's script", () => {
  const cases: [string, string][] = [
    // Sinhala (the first three from the Sinhala model on English speech)
    ["ෆෝන්", "phone"],
    ["ලින්ක්", "link"],
    ["ස්ක්‍රීන්", "screen"],
    ["වීඩියෝ", "video"],
    ["කොම්පියුටර්", "computer"],
    ["ඩවුන්ලෝඩ්", "download"],
    ["ක්ලික්", "click"],
    ["අප්ලෝඩ්", "upload"],
    ["මැසේජ්", "message"],
    ["කැප්ෂන්", "caption"],
    ["ෂෙයාර්", "share"],
    ["ඔන්ලයින්", "online"],
    ["සෙටින්ග්ස්", "settings"],
    ["ඇප්", "app"],
    ["බස්", "bus"],
    ["ටයිම්", "time"],
    ["ෆිල්ම්", "film"],
    ["ස්ටාර්ට්", "start"],
    ["මීටින්", "meeting"],
    // Hindi
    ["वीडियो", "video"],
    ["फ़ोन", "phone"],
    ["कंप्यूटर", "computer"],
    ["डाउनलोड", "download"],
    ["मीटिंग", "meeting"],
    ["लैपटॉप", "laptop"],
    // Tamil
    ["வீடியோ", "video"],
    ["ஃபோன்", "phone"],
    ["லிங்க்", "link"],
    ["டவுன்லோட்", "download"],
    ["கம்ப்யூட்டர்", "computer"],
    // Kannada, Telugu
    ["ವೀಡಿಯೋ", "video"],
    ["వీడియో", "video"],
  ];
  for (const [word, en] of cases) assert.equal(englishFor(word), en, word);
});

test("leaves native words alone", () => {
  const native = [
    // Sinhala
    "මම", "ඔයා", "අපි", "එයා", "මේ", "ඒ", "කොහොමද", "හොඳයි", "නැහැ", "ඔව්", "දැන්", "ගිහින්", "කරන්න", "බලන්න",
    "යන්න", "එන්න", "තියෙනවා", "කියලා", "වගේ", "නම්", "එක", "එකක්", "ගැන", "සමග", "විතරයි", "හරි", "ලොකු",
    "පොඩි", "වැඩ", "ගෙදර", "කෑම", "වතුර", "දවස", "අද", "හෙට", "ඊයේ", "රට", "මිනිස්සු", "පාර", "බත්", "මට",
    "වෙලා", "දෙන්න", "පුළුවන්", "ලස්සන", "සල්ලි", "කඩේ", "එක්", "හිත්", "ගත්", "කන්", "ටිකක්", "මීටර්", "දා",
    "මෙහෙම", "වලින්", "ඕක", "අම්මා", "තාත්තා", "යාළුවා", "පොත", "ඉස්කෝලේ", "කාලය", "හොඳ", "නරක", "ලෝකය",
    // Hindi
    "कर", "बस", "पास", "सर", "मन", "काम", "नाम", "हम", "तुम", "है", "और", "लेकिन", "क्या", "यह", "वह", "बात",
    "समय", "लोग", "दिन", "पानी", "बहुत", "अच्छा", "मैं", "में", "को", "से", "पर", "था", "भी", "घर", "देखो",
    // Tamil
    "நான்", "நீ", "அவன்", "இது", "அது", "என்ன", "இல்லை", "ஆமாம்", "வா", "போ", "பார்", "சொல்", "நல்ல", "வீடு",
    "எனக்கு", "வேலை", "பணம்", "நேரம்", "இப்போ", "கடை", "படம்",
  ];
  for (const word of native) assert.equal(englishFor(word), null, word);
});

test("keepEnglish keeps punctuation, Latin words and the hint", () => {
  const w = (text: string) => ({ start: 0, end: 1, text });
  const out = keepEnglish([w("ෆෝන්,"), w("එක"), w("share"), w("“ලින්ක්”"), w("රුවන්")], "Ruwan, Kandy").map((x) => x.text);
  assert.deepEqual(out, ["phone,", "එක", "share", "“link”", "Ruwan"]);
});
