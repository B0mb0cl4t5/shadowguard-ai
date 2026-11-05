import re
from pathlib import Path

from build_real_catalog_sql import TARGET, build
from real_catalog import REAL_APPS, REAL_VENDORS

ROOT = Path(__file__).resolve().parents[2]
DOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
CATEGORIES = {"chat_assistant", "summariser", "writing", "transcription", "code_assistant",
              "slides", "research", "image", "grading"}


def test_migration_matches_the_catalogue():
    assert TARGET.read_text(encoding="utf-8") == build(), "run backend/scripts/build_real_catalog_sql.py"


def test_catalogue_fits_the_schema():
    vendors = {name for name, _, _ in REAL_VENDORS}
    for _, vendor, domain, category in REAL_APPS:
        assert vendor in vendors
        assert DOMAIN_RE.fullmatch(domain), domain
        assert category in CATEGORIES, category
    assert all(url.startswith("https://") for _, _, url in REAL_VENDORS)


def test_collector_watches_exactly_the_catalogued_domains():
    import sys

    sys.path.insert(0, str(ROOT / "collector"))
    from shadowguard_collector import AI_DOMAINS

    assert set(AI_DOMAINS) == {domain for _, _, domain, _ in REAL_APPS}
