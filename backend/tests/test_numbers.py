"""Numbers in words for the fast voice in French, German, Spanish and
Italian (app/pipeline/numbers.py)."""

import unittest

from app.pipeline.numbers import spell_numbers


def said(lang: str, *values: int) -> list[str]:
    return [spell_numbers(str(v), lang) for v in values]


class NumbersTest(unittest.TestCase):
    def test_french(self) -> None:
        self.assertEqual(
            said("fr", 0, 1, 16, 17, 21, 71, 80, 81, 91, 99, 100, 101, 200, 201, 1000, 2026, 80000, 200000, 1000000, 2000000),
            ["zéro", "un", "seize", "dix-sept", "vingt et un", "soixante et onze", "quatre-vingts", "quatre-vingt-un", "quatre-vingt-onze",
             "quatre-vingt-dix-neuf", "cent", "cent un", "deux cents", "deux cent un", "mille", "deux mille vingt-six", "quatre-vingt mille",
             "deux cent mille", "un million", "deux millions"],
        )  # fmt: skip

    def test_german(self) -> None:
        self.assertEqual(
            said("de", 1, 12, 21, 101, 1000, 1001, 2026, 1000000, 3000000),
            ["eins", "zwölf", "einundzwanzig", "einhunderteins", "eintausend", "eintausendeins", "zweitausendsechsundzwanzig", "eine Million", "drei Millionen"],
        )

    def test_spanish(self) -> None:
        self.assertEqual(
            said("es", 1, 16, 21, 22, 31, 100, 101, 500, 1000, 21000, 1000000, 2000000, 1000000000),
            ["uno", "dieciséis", "veintiuno", "veintidós", "treinta y uno", "cien", "ciento uno", "quinientos", "mil", "veintiún mil",
             "un millón", "dos millones", "mil millones"],
        )  # fmt: skip

    def test_italian(self) -> None:
        self.assertEqual(
            said("it", 1, 21, 23, 28, 103, 1000, 2026, 21000, 1000000, 2000000),
            ["uno", "ventuno", "ventitré", "ventotto", "centotré", "mille", "duemilaventisei", "ventunomila", "un milione", "due milioni"],
        )

    def test_in_text(self) -> None:
        self.assertEqual(spell_numbers("Le prix est passé de 250 € à 3 000 €.", "fr"), "Le prix est passé de deux cent cinquante euros à trois mille euros.")
        self.assertEqual(spell_numbers("Es kostet 1.500 Euro, also 3,5 % mehr.", "de"), "Es kostet eintausendfünfhundert Euro, also drei Komma fünf Prozent mehr.")
        self.assertEqual(spell_numbers("Cuesta $5 o 1 €.", "es"), "Cuesta cinco dólares o un euro.")
        self.assertEqual(spell_numbers("Il 12% di 0,05", "it"), "Il dodici per cento di zero virgola zero cinque")
        self.assertEqual(spell_numbers("1 € und 21 €", "de"), "ein Euro und einundzwanzig Euro")
        self.assertEqual(spell_numbers("21 €", "it"), "ventun euro")

    def test_left_alone(self) -> None:
        for text in ("version 2.0.1", "un fichier mp3", "10h30", "ISO-9001x", "1234567890123"):
            with self.subTest(text=text):
                self.assertEqual(spell_numbers(text, "fr"), text)
        self.assertEqual(spell_numbers("It costs 250 dollars.", "en"), "It costs 250 dollars.")  # the English voice reads digits


if __name__ == "__main__":
    unittest.main()
