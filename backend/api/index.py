"""Vercel Python serverless entry point.

The root vercel.json declares this as the ``backend`` service's entrypoint.
FastAPI routes on the original request path (/api/health, /api/v1/...), whether
the call arrives over the frontend's binding or the public telemetry rewrite.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shadowguard.app import app  # noqa: E402

__all__ = ["app"]
