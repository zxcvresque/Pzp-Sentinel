"""Package the local Helium extractor without generated files or dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / "tools/helium-bmc-session-extractor"
destination = root / "public/downloads/helium-bmc-session-extractor.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for name in ("manifest.json", "popup.html", "popup.css", "popup.js", "README.md"):
        archive.write(source / name, f"helium-bmc-session-extractor/{name}")
print("Packaged Helium BMC session extractor.")
