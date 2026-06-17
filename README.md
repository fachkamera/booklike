# BookLike

A browser extension to turn any article into a book-like reading experience.

[![BookLike Reader, before and after](assets/booklike-before-after.avif)](https://booklike.app)

## Install

Available on the [Chrome Web Store](https://chromewebstore.google.com/detail/booklike-reader/mhiinmnbbndkgjmcjeildbenndjhddlj).

## Usage

Activate on any web article via the toolbar icon, keyboard shortcut, or right-click menu.

## Features

- _Book-like_ pagination: flip through pages, no scrolling
- Beautiful customizable typography
- Best-in-class content extraction
- Dual dark mode for UI and reader
- One-click EPUB export
- Integrated dictionary (EN only)
- Private by design: no background activity, no tracking, minimal permissions

> **Note:** EPUB creation happens on-device. When image embedding is enabled, an API hosted on `booklike.app` is used for image fetching and re-encoding to handle CORS and image formats not supported by the EPUB spec.

## Building from source

```
pnpm install && pnpm build
```

Then load the `dist/` folder as an unpacked extension in Chrome: `chrome://extensions` → enable Developer mode → Load unpacked.
