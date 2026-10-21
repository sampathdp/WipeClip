"""Job tickets marked `local` (the desktop app's credit-free jobs) are refused
by the cloud backend and accepted by the desktop engine.

Run from the backend folder:  python -m unittest tests.test_local_tickets
"""

from __future__ import annotations

import base64
import json
import time
import unittest
from unittest import mock

from fastapi import HTTPException

from app import tickets


def unsigned(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{body}.unsigned"


class LocalTicketTest(unittest.TestCase):
    def setUp(self) -> None:
        exp = (time.time() + 600) * 1000
        self.local = unsigned({"kind": "process", "local": True, "cost": 0, "exp": exp})
        self.cloud = unsigned({"kind": "process", "cost": 1, "exp": exp})

    def test_cloud_refuses_local_ticket(self) -> None:
        with mock.patch.object(tickets, "LOCAL_MODE", False), mock.patch.dict("os.environ", {}, clear=False):
            with self.assertRaises(HTTPException) as ctx:
                tickets.verify(self.local, "process")
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertEqual(tickets.verify(self.cloud, "process")["cost"], 1)

    def test_engine_accepts_local_ticket(self) -> None:
        with mock.patch.object(tickets, "LOCAL_MODE", True):
            self.assertTrue(tickets.verify(self.local, "process")["local"])


if __name__ == "__main__":
    unittest.main()
