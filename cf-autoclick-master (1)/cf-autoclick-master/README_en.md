[English](./README_en.md) | [简体中文](./README.md)

---
# CDP Extension — Usage Instructions

This is a Chrome extension script that uses the Chrome DevTools Protocol (CDP) to automatically click Cloudflare Turnstile captchas.

Install the extension into Chrome (or Chromium) by following these steps:

1. Download the ZIP
   - Package this project as a ZIP file and download it to your local machine.

2. Open the Extensions page
   - Type `chrome://extensions` in the Chrome address bar and press Enter.

3. Enable Developer mode
   - Turn on "Developer mode" in the top-right corner of the page.

4. Drag and drop to install the ZIP
   - Drag the unziped downloaded ZIP file onto the extensions page.
   - Chrome will automatically detect and install the extension.

5. Usage and verification
   - After installation, open the target webpage (for example, a page that contains Cloudflare/Turnstile verification). The extension will inject the script into the appropriate iframe and operate according to its logic.
   - For debugging, check the background page logs on the extension page or open DevTools to view the injected script's output.
   - The annoying Chrome popup can be disabled using the `--silent-debugger-extension-api` flag.
