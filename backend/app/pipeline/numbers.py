"""Numbers written out in words, for the fast voice in French, German,
Spanish and Italian (dub.FastVoice): those voices read digits as noise
("250 euros" came out as "Gan Rori Sooro"), while the English one reads them
well. Whole numbers up to 999 999 999 999, decimals, percentages and the
euro, dollar and pound signs; anything else is left as it is.

    spell_numbers("Le prix est passé de 250 € à 3 000 €.", "fr")
    -> "Le prix est passé de deux cent cinquante euros à trois mille euros."
"""

from __future__ import annotations

import re

# --- French ------------------------------------------------------------------

_FR_UNITS = "zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize".split()
_FR_TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}


def _fr_99(n: int) -> str:
    if n <= 16:
        return _FR_UNITS[n]
    if n < 20:
        return "dix-" + _FR_UNITS[n - 10]
    if n < 70:
        t, u = divmod(n, 10)
        return _FR_TENS[t] + ("" if u == 0 else " et un" if u == 1 else "-" + _FR_UNITS[u])
    if n < 80:
        return "soixante" + (" et onze" if n == 71 else "-" + _fr_99(n - 60))
    if n == 80:
        return "quatre-vingts"
    return "quatre-vingt-" + _fr_99(n - 80)


def _fr_999(n: int, last: bool = True) -> str:
    """0-999; `last`: nothing follows ("deux cents" but "deux cent mille",
    "quatre-vingts" but "quatre-vingt mille")."""
    h, r = divmod(n, 100)
    if h == 0:
        return _fr_99(r) if last or r != 80 else "quatre-vingt"
    head = "cent" if h == 1 else _FR_UNITS[h] + " cent"
    if r == 0:
        return head + ("s" if h > 1 and last else "")
    return head + " " + (_fr_99(r) if last or r != 80 else "quatre-vingt")


def _fr(n: int) -> str:
    if n == 0:
        return "zéro"
    parts = []
    for size, one, many in ((10**9, "un milliard", "milliards"), (10**6, "un million", "millions")):
        k, n = divmod(n, size)
        if k:
            parts.append(one if k == 1 else f"{_fr(k)} {many}")
    k, n = divmod(n, 1000)
    if k:
        parts.append("mille" if k == 1 else _fr_999(k, last=False) + " mille")
    if n:
        parts.append(_fr_999(n))
    return " ".join(parts)


# --- German ------------------------------------------------------------------

_DE_UNITS = "null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn".split()
_DE_TENS = {2: "zwanzig", 3: "dreißig", 4: "vierzig", 5: "fünfzig", 6: "sechzig", 7: "siebzig", 8: "achtzig", 9: "neunzig"}


def _de_999(n: int, alone: bool = True) -> str:
    h, r = divmod(n, 100)
    out = "" if h == 0 else ("ein" if h == 1 else _DE_UNITS[h]) + "hundert"
    if r:
        if r < 20:
            out += "eins" if r == 1 and alone else "ein" if r == 1 else _DE_UNITS[r]
        else:
            t, u = divmod(r, 10)
            out += ("" if u == 0 else ("ein" if u == 1 else _DE_UNITS[u]) + "und") + _DE_TENS[t]
    return out


def _de(n: int) -> str:
    if n == 0:
        return "null"
    parts = []
    for size, one, many in ((10**9, "eine Milliarde", "Milliarden"), (10**6, "eine Million", "Millionen")):
        k, n = divmod(n, size)
        if k:
            parts.append(one if k == 1 else f"{_de(k)} {many}")
    k, n = divmod(n, 1000)
    word = ""
    if k:
        word = _de_999(k, alone=False) + "tausend"
    if n:
        word += _de_999(n)
    if word:
        parts.append(word)
    return " ".join(parts)


# --- Spanish -----------------------------------------------------------------

_ES_29 = (
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve "
    "veinte veintiuno veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho veintinueve"
).split()
_ES_TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa"}
_ES_HUNDREDS = {
    2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos",
    6: "seiscientos", 7: "setecientos", 8: "ochocientos", 9: "novecientos",
}  # fmt: skip


def _es_999(n: int) -> str:
    h, r = divmod(n, 100)
    out = []
    if h:
        out.append(("cien" if r == 0 else "ciento") if h == 1 else _ES_HUNDREDS[h])
    if r:
        if r < 30:
            out.append(_ES_29[r])
        else:
            t, u = divmod(r, 10)
            out.append(_ES_TENS[t] + ("" if u == 0 else " y " + _ES_29[u]))
    return " ".join(out)


def _es_before_noun(words: str) -> str:
    """"uno" said before mil, millón: "veintiún mil", "un millón"."""
    if words.endswith("veintiuno"):
        return words[: -len("veintiuno")] + "veintiún"
    if words.endswith("uno"):
        return words[:-1]
    return words


def _es(n: int) -> str:
    if n == 0:
        return "cero"
    parts = []
    for size, one, many in ((10**9, "mil millones", "mil millones"), (10**6, "un millón", "millones")):
        k, n = divmod(n, size)
        if k:
            parts.append(one if k == 1 else f"{_es_before_noun(_es(k))} {many}")
    k, n = divmod(n, 1000)
    if k:
        parts.append("mil" if k == 1 else _es_before_noun(_es_999(k)) + " mil")
    if n:
        parts.append(_es_999(n))
    return " ".join(parts)


# --- Italian -----------------------------------------------------------------

_IT_UNITS = "zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove".split()
_IT_TENS = {2: "venti", 3: "trenta", 4: "quaranta", 5: "cinquanta", 6: "sessanta", 7: "settanta", 8: "ottanta", 9: "novanta"}


def _it_99(n: int) -> str:
    if n < 20:
        return _IT_UNITS[n]
    t, u = divmod(n, 10)
    ten = _IT_TENS[t]
    if u == 0:
        return ten
    if u in (1, 8):
        ten = ten[:-1]  # ventuno, ventotto
    return ten + ("tré" if u == 3 else _IT_UNITS[u])


def _it_999(n: int) -> str:
    h, r = divmod(n, 100)
    head = "" if h == 0 else "cento" if h == 1 else _IT_UNITS[h] + "cento"
    if h and r == 3:
        return head + "tré"  # centotré
    return head + (_it_99(r) if r else "")


def _it(n: int) -> str:
    if n == 0:
        return "zero"
    parts = []
    for size, one, many in ((10**9, "un miliardo", "miliardi"), (10**6, "un milione", "milioni")):
        k, n = divmod(n, size)
        if k:
            parts.append(one if k == 1 else f"{_it(k)} {many}")
    k, n = divmod(n, 1000)
    word = ""
    if k:
        word = "mille" if k == 1 else _it_999(k) + "mila"
    if n:
        word += _it_999(n)
    if word:
        parts.append(word)
    return " ".join(parts)


# --- Text --------------------------------------------------------------------

_SAY = {"fr": _fr, "de": _de, "es": _es, "it": _it}
_POINT = {"fr": "virgule", "de": "Komma", "es": "coma", "it": "virgola"}
_PERCENT = {"fr": "pour cent", "de": "Prozent", "es": "por ciento", "it": "per cento"}
_MONEY = {
    "€": {"fr": ("euro", "euros"), "de": ("Euro", "Euro"), "es": ("euro", "euros"), "it": ("euro", "euro")},
    "$": {"fr": ("dollar", "dollars"), "de": ("Dollar", "Dollar"), "es": ("dólar", "dólares"), "it": ("dollaro", "dollari")},
    "£": {"fr": ("livre", "livres"), "de": ("Pfund", "Pfund"), "es": ("libra", "libras"), "it": ("sterlina", "sterline")},
}
_MAX = 10**12

# A number: digits in groups of three after a thousands separator (space,
# no-break space, dot or comma, or an apostrophe), then an optional decimal
# part. The money sign may come before or after it, the percent sign after.
# Dotted sequences ("2.0.1") and numbers inside words ("mp3") aren't read.
_NUMBER = re.compile(
    r"(?P<pre>[€$£]\s?)?"
    r"(?<![\w.,])(?P<int>\d{1,3}(?:(?P<sep>[   .,'])\d{3})(?:(?P=sep)\d{3})*|\d+)"
    r"(?:(?P<dec>[.,])(?P<frac>\d+))?(?![\w]|[.,]\d)"
    r"(?P<post>\s?(?:[€$£%]))?"
)


def _before_noun(words: str, lang: str) -> str:
    """A number's last word as said before a noun: "un euro", "ein Euro",
    "veintiún euros", "ventun euro"."""
    if lang == "es":
        return _es_before_noun(words)
    if lang == "de" and words.endswith("eins"):
        return words[:-1]
    if lang == "it" and words.endswith("uno"):
        return words[:-1]
    return words


def spell_numbers(text: str, lang: str) -> str:
    """`text` with its numbers in words of `lang` (fr, de, es, it); other
    languages, and numbers too big or not read as numbers, unchanged."""
    say = _SAY.get(lang)
    if say is None:
        return text

    def one(m: re.Match) -> str:
        digits, sep, dec, frac = m["int"], m["sep"], m["dec"], m["frac"]
        if sep and dec and sep == dec:
            return m[0]  # "1.234.5": not a number we can read
        if sep is None and dec and len(frac) == 3 and digits != "0":
            # "1.500" / "1,500": a thousands separator in all four
            # languages (they write decimals with a comma, English-style
            # text with a point; three digits after either is far more
            # often thousands).
            digits, dec, frac = digits + frac, None, None
        value = int(re.sub(r"\D", "", digits))
        if value >= _MAX:
            return m[0]
        words = say(value)
        if frac:
            words += f" {_POINT[lang]} " + (say(int(frac)) if not frac.startswith("0") else " ".join(say(int(d)) for d in frac))
        sign = (m["pre"] or "").strip() or (m["post"] or "").strip()
        if sign == "%":
            words += " " + _PERCENT[lang]
        elif sign:
            singular, plural = _MONEY[sign][lang]
            if not frac:
                words = _before_noun(words, lang)
            words += " " + (singular if value == 1 and not frac else plural)
        return words

    return _NUMBER.sub(one, text)
