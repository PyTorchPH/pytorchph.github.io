# Resume Icon Assets

Drop real brand icons here to override the renderer fallback icons.

Supported names:

- `github-icon.svg`, `github-icon.png`, `github-icon.jpg`, or `github-icon.jpeg`
- `linkedin-icon.svg`, `linkedin-icon.png`, `linkedin-icon.jpg`, or `linkedin-icon.jpeg`
- `fb-icon.svg`, `fb-icon.png`, `fb-icon.jpg`, or `fb-icon.jpeg`
- `facebook-icon.svg`, `facebook-icon.png`, `facebook-icon.jpg`, or `facebook-icon.jpeg`

HTML output embeds these files as data-URI images and sizes them to the requested
icon size. PDF output uses PNG/JPG/JPEG assets when available; SVG assets still
work in HTML and fall back to the built-in vector icon in direct PDF rendering.
