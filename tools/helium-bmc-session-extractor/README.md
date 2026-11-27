# Helium BMC session extractor

A local Manifest V3 extension for copying your own signed-in Buy Me a Coffee session into Sentinel. No server-hosted browser is involved.

1. Download the extractor ZIP from Sentinel's BMC connection page and unzip it.
2. Open `chrome://extensions` in Helium, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. Open your signed-in BMC creator dashboard. Open the extension and select **Copy session for Sentinel**.
4. In Sentinel → Transactions → BMC connection, paste into **Helium session** and select **Verify and save session**. Clear your clipboard afterward.

The browser permission prompt grants the extension access to BMC cookies, including HttpOnly authentication cookies. Ordinary console JavaScript cannot read those cookies. Enable **Allow in Incognito** on the extension only if your BMC session is in an Incognito window; it selects the active tab's cookie store and never blends normal and Incognito sessions. It does not change BMC login credentials.

The extension has no background worker, storage permission, network calls, telemetry or external dependencies. It reads cookies only when you press Copy, from app/studio BMC origins in the active window, and writes a versioned JSON session value to your clipboard. The value is a credential, not encryption. Paste only into your own Sentinel instance. The server validates the account before saving the session encrypted; it never returns saved cookies to the browser. Remove the unpacked extension when no longer needed.

Regenerate the downloadable ZIP after editing these files using `python3 scripts/package-bmc-session-extractor.py` from the repository root.
