"""Vercel Python function: GET /api/route (see tynys.service.route)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tynys.web import ApiHandler  # noqa: E402


class handler(ApiHandler):
    endpoint = "route"
