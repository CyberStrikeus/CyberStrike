"""Prepare downloads, the sitemap and the sharing image for the static website."""

from io import BytesIO
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from website import PageMetadata, page_url


EXAMPLE_FILES = (
    "package.json",
    "main.js",
    "preload.js",
    "renderer.js",
    "csv.js",
    "index.html",
)


def prepare_sitemap(site):
    """Discover HTML routes automatically, excluding pages marked noindex."""
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    sitemap = ET.Element(f"{{{namespace}}}urlset")
    for path in sorted(site.rglob("*.html")):
        policy = PageMetadata()
        policy.feed(path.read_text(encoding="utf-8"))
        if policy.noindex:
            continue
        entry = ET.SubElement(sitemap, f"{{{namespace}}}url")
        ET.SubElement(
            entry, f"{{{namespace}}}loc"
        ).text = page_url(site, path)
    ET.indent(sitemap, space="  ")
    ET.ElementTree(sitemap).write(
        site / "sitemap.xml", encoding="utf-8", xml_declaration=True
    )
    print(f"Prepared sitemap.xml ({len(sitemap)} indexable pages).")


def prepare_sharing_image(site):
    """Rasterize the maintained SVG for clients that need a PNG preview."""
    try:
        import cairosvg
    except (ImportError, OSError) as error:
        sys.exit(
            f"Cannot prepare sharing image: {error}. Install website/requirements.txt and native Cairo; see website/README.md."
        )
    source = site / "assets/social-card.svg"
    destination = site / "assets/social-card.png"
    cairosvg.svg2png(
        url=str(source), write_to=str(destination), output_width=1200, output_height=630
    )
    print("Prepared assets/social-card.png (1200 × 630).")


def prepare_notes_example(site):
    """Create a ZIP with public source only and reproducible metadata."""
    source = site / "examples/notes-electron"
    contents = BytesIO()
    with ZipFile(contents, "w") as archive:
        for name in EXAMPLE_FILES:
            entry = ZipInfo(f"notes-example/{name}", (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(
                entry,
                (source / name).read_bytes(),
                compress_type=ZIP_DEFLATED,
                compresslevel=9,
            )
    destination = site / "examples/notes-example.zip"
    destination.write_bytes(contents.getvalue())
    print(f"Prepared examples/notes-example.zip ({len(EXAMPLE_FILES)} files).")


def prepare_assets(site):
    """Finish the shared publish artifact before it replaces the current preview."""
    prepare_sharing_image(site)
    prepare_sitemap(site)
    prepare_notes_example(site)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    from website_i18n import build_translations
    build_translations(root, root / "website/_site", finalize=prepare_assets)
