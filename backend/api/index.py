"""Vercel Python serverless entry point.

vercel.json rewrites every path to this function; FastAPI then routes on the
original request path (/api/health, /api/v1/...).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shadowguard.app import app  # noqa: E402

__all__ = ["app"]
