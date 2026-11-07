"""Possibly sensitive text on screen, from OCR lines: what kind it looks like
and where, never the value itself. Pure - see tests/test_scenes.py (which
uses made-up values only).

Patterns plus checks that cut false alarms: card numbers must pass the Luhn
check, bank account numbers (IBAN) their mod-97 check, generic secrets must
look random. It can't find everything - text the OCR misreads or can't see
(images, tiny or blurred text, non-Latin scripts) is missed - so every
result is a suggestion the user reviews, and the editor says so.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

Box = tuple[int, int, int, int]


@dataclass
class Finding:
    category: str  # "email" | "phone" | "card" | "iban" | "key" | "token" | "private-key" | "connection" | "password" | "secret"
    box: Box
    confidence: float  # 0..1
    reason: str  # plain words, never the value


_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,4}(?![\w.])")
_DIGITS = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b")
# Known key and token formats (prefixes vendors document).
_KEYS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "key", "a cloud access key ID"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "key", "a cloud API key"),
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b|\bgithub_pat_[0-9A-Za-z_]{40,}\b"), "token", "a code hosting access token"),
    (re.compile(r"\bglpat-[0-9A-Za-z_-]{20,}\b"), "token", "a code hosting access token"),
    (re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}\b"), "token", "a chat app token"),
    (re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}\b"), "key", "a payment API key"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"), "key", "an API secret key"),
    (re.compile(r"\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}"), "token", "a signed login token"),
]
_PRIVATE_KEY = re.compile(r"-{3,}\s*BEGIN [A-Z ]*PRIVATE KEY", re.I)
_CONNECTION = re.compile(r"\b[a-z][a-z0-9+.-]{1,20}://[^\s:/@]+:[^\s@/]{3,}@[^\s/]+", re.I)
_BEARER = re.compile(r"\b(?:authorization\s*[:=]\s*)?bearer\s+[A-Za-z0-9._~+/=-]{16,}", re.I)
_ASSIGN = re.compile(
    r"\b([A-Za-z0-9_.-]*(?:secret|token|api[_-]?key|apikey|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|client[_-]?secret|auth)[A-Za-z0-9_.-]*)\s*[:=]\s*[\"']?([^\s\"']{8,})",
    re.I,
)
# Screens are full of digit groups (IDs, sizes, versions), so a phone number
# needs a sign it is one: a leading +, a bracketed area code, or a word.
_PHONE_WORD = re.compile(r"\b(?:phone|tel|telephone|mobile|cell|call|contact|whatsapp|fax)\b", re.I)
_PASSWORD_LABEL = re.compile(r"\bpass(?:word|code|phrase)\b|\bpin\b", re.I)


def luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def iban_ok(s: str) -> bool:
    s = s.replace(" ", "")
    if not 15 <= len(s) <= 34:
        return False
    moved = s[4:] + s[:4]
    try:
        n = int("".join(str(int(c, 36)) for c in moved))
    except ValueError:
        return False
    return n % 97 == 1


def entropy(s: str) -> float:
    """Bits per character: random keys score high, words and paths low."""
    if not s:
        return 0.0
    counts: dict[str, int] = {}
    for c in s:
        counts[c] = counts.get(c, 0) + 1
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def _looks_random(v: str) -> bool:
    kinds = sum(bool(re.search(p, v)) for p in (r"[a-z]", r"[A-Z]", r"\d"))
    return len(v) >= 12 and entropy(v) >= 3.2 and kinds >= 2


def _part(box: Box, text: str, start: int, end: int) -> Box:
    """The part of a line's box that holds text[start:end] (characters are
    taken as equally wide - close enough to cover it, with a margin)."""
    x, y, w, h = box
    n = max(1, len(text))
    x0 = x + w * max(0, start - 1) / n
    x1 = x + w * min(n, end + 1) / n
    return (int(x0), y, max(1, int(x1 - x0)), h)


def scan_line(text: str, box: Box) -> list[Finding]:
    """Findings in one OCR line."""
    out: list[Finding] = []

    def add(category: str, m: re.Match[str], confidence: float, reason: str, group: int = 0) -> None:
        out.append(Finding(category, _part(box, text, m.start(group), m.end(group)), confidence, reason))

    if _PRIVATE_KEY.search(text):
        out.append(Finding("private-key", box, 0.9, "The start of a private key block"))
    for pattern, category, what in _KEYS:
        for m in pattern.finditer(text):
            add(category, m, 0.9, f"Looks like {what}")
    for m in _CONNECTION.finditer(text):
        add("connection", m, 0.85, "A connection address with a password in it")
    for m in _BEARER.finditer(text):
        add("token", m, 0.8, "An authorization token")
    for m in _ASSIGN.finditer(text):
        value = m.group(2)
        if _looks_random(value) or re.search(r"passw|pwd", m.group(1), re.I):
            add("secret", m, 0.75 if _looks_random(value) else 0.6, "A value assigned to a secret-sounding name", 2)
    for m in _EMAIL.finditer(text):
        add("email", m, 0.85, "An email address")
    for m in _DIGITS.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and luhn(digits) and len(set(digits)) > 1:
            add("card", m, 0.85, "A number that passes the payment card check")
    for m in _IBAN.finditer(text.upper()):
        if iban_ok(m.group(0)):
            add("iban", m, 0.85, "A bank account number (IBAN) that passes its check")
    taken = [f.box for f in out]
    for m in _PHONE.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        # Dates, times and version numbers are the usual false alarms.
        if not 9 <= len(digits) <= 15 or re.fullmatch(r"\d{1,4}[./-]\d{1,2}[./-]\d{1,4}", m.group(0).strip()):
            continue
        sure = m.group(0).lstrip().startswith("+") or "(" in m.group(0)
        if not sure and not _PHONE_WORD.search(text):
            continue
        b = _part(box, text, m.start(), m.end())
        if any(_overlap(b, t) > 0.5 for t in taken):
            continue
        add("phone", m, 0.6 if sure else 0.5, "Looks like a phone number")
    return out


def _overlap(a: Box, b: Box) -> float:
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy / max(1, min(a[2] * a[3], b[2] * b[3]))


def password_fields(lines: list[tuple[str, Box]], width: int) -> list[Finding]:
    """A "password" label suggests the field next to it (to its right on the
    same row, else just below) - the dots themselves rarely survive OCR. A
    guess about where the field is, so medium-low confidence."""
    out = []
    for text, (x, y, w, h) in lines:
        if not _PASSWORD_LABEL.search(text) or len(text) > 40:
            continue
        right = [b for t, b in lines if b[0] > x + w and abs((b[1] + b[3] / 2) - (y + h / 2)) < h]
        if right:
            bx = min(right, key=lambda b: b[0])
            out.append(Finding("password", (bx[0], y - h // 2, min(width - bx[0], max(bx[2], w * 2)), h * 2), 0.5, "A field next to a password label"))
        else:
            out.append(Finding("password", (x, y + h, min(width - x, max(w * 2, 12 * h)), int(h * 2.2)), 0.4, "A field under a password label"))
    return out


def scan(lines: list[tuple[str, Box]], width: int) -> list[Finding]:
    """Every finding in a frame's OCR lines."""
    found: list[Finding] = []
    for text, box in lines:
        found += scan_line(text, box)
    return found + password_fields(lines, width)
