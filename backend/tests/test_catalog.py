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


def test_collector_hashes_with_a_secret_salt_it_keeps(tmp_path):
    """Hashing a guessable account name without a secret could be reversed by trying names."""
    import sys

    sys.path.insert(0, str(ROOT / "collector"))
    from shadowguard_collector import collector_salt

    salt_file = tmp_path / "sub" / "collector-salt"
    first = collector_salt(env={}, path=salt_file)
    assert len(first) == 64 and int(first, 16) >= 0  # 256 random bits
    assert collector_salt(env={}, path=salt_file) == first  # kept, so the same person keeps one hash
    assert collector_salt(env={"SHADOWGUARD_HASH_SALT": "from-the-environment"}, path=salt_file) == "from-the-environment"
    salt_file.write_text("", encoding="ascii")
    assert len(collector_salt(env={}, path=salt_file)) == 64  # an emptied file gets a fresh secret
