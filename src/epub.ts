import { zipSync, strToU8 } from 'fflate'

export interface EpubImage {
  data: Uint8Array
  mime: string
}

export interface EpubPayload {
  title: string
  author: string | null
  date: string | null
  sourceUrl: string
  content: string
  lang: string
}

const VOID_ELEMENTS = /(<(?:img|br|hr|input|meta|link|area|base|col|embed|param|source|track|wbr)\b[^>]*?)>/gi

function buildToc(content: string): {
  content: string
  entries: { id: string; title: string }[]
} {
  const entries: { id: string; title: string }[] = []
  let counter = 0
  const result = content.replace(
    /<(h[23])(\b[^>]*?)>([\s\S]*?)<\/h[23]>/gi,
    (_: string, tag: string, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      if (!text) return _
      const existingId = /\bid="([^"]*)"/.exec(attrs)
      const id = existingId?.[1] ?? `h${++counter}`
      const newAttrs = existingId ? attrs : `${attrs} id="${id}"`
      entries.push({ id, title: text })
      return `<${tag}${newAttrs}>${inner}</${tag}>`
    },
  )
  return { content: result, entries }
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: '&#160;',
  ndash: '&#8211;',
  mdash: '&#8212;',
  laquo: '&#171;',
  raquo: '&#187;',
  ldquo: '&#8220;',
  rdquo: '&#8221;',
  lsquo: '&#8216;',
  rsquo: '&#8217;',
  hellip: '&#8230;',
  copy: '&#169;',
  reg: '&#174;',
  trade: '&#8482;',
  euro: '&#8364;',
  pound: '&#163;',
  yen: '&#165;',
  cent: '&#162;',
  amp: '&amp;',
  lt: '&lt;',
  gt: '&gt;',
  quot: '&quot;',
}

function toXhtml(html: string): string {
  return html
    .replace(VOID_ELEMENTS, '$1/>')
    .replace(/\bxlink:href=/g, 'href=')
    .replace(/\bxmlns:xlink="[^"]*"/g, '')
    .replace(/&([a-z]+);/gi, (m: string, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m)
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const IMG_TAG = /(<img\b[^>]*?\ssrc=")([^"]+)("[^>]*?>)/gi
const FIGURE_TAG = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi

function embedImages(
  content: string,
  imageMap: Map<string, EpubImage>,
): { content: string; files: Record<string, Uint8Array>; manifest: string } {
  const files: Record<string, Uint8Array> = {}
  const manifestItems: string[] = []
  let i = 0

  // First pass: replace known img srcs with local filenames, collect unknown srcs
  const unknownSrcs = new Set<string>()
  const rewritten = content.replace(IMG_TAG, (_match, pre: string, src: string, post: string) => {
    const decoded = src.replaceAll('&amp;', '&')
    const imageData = imageMap.get(decoded)
    if (!imageData) {
      unknownSrcs.add(decoded)
      return _match
    }
    const ext = imageData.mime === 'image/png' ? 'png' : 'jpg'
    const filename = `img${i}.${ext}`
    files[`OEBPS/images/${filename}`] = imageData.data
    manifestItems.push(`<item id="img${i}" href="images/${filename}" media-type="${imageData.mime}"/>`)
    i++
    return `${pre}images/${filename}${post}`
  })

  // Second pass: remove figures containing only unresolved images
  const result = rewritten.replace(FIGURE_TAG, (figure: string) => {
    const srcMatch = /\ssrc="([^"]+)"/.exec(figure)
    if (!srcMatch) return figure
    const src = srcMatch[1].replaceAll('&amp;', '&')
    return unknownSrcs.has(src) ? '' : figure
  })

  return { content: result, files, manifest: manifestItems.join('\n    ') }
}

export function buildEpub(payload: EpubPayload, imageMap?: Map<string, EpubImage>): Uint8Array {
  const { title, author, date, sourceUrl } = payload
  const lang = payload.lang && payload.lang !== 'und' ? payload.lang : 'en'
  let { content } = payload
  const id = crypto.randomUUID()
  const now = new Date().toISOString().slice(0, 10)
  const creator =
    author ??
    (() => {
      try {
        return new URL(sourceUrl).hostname.replace(/^www\./, '')
      } catch {
        return null
      }
    })()

  const imageFiles: Record<string, Uint8Array> = {}
  let imageManifest = ''
  if (imageMap) {
    const embedded = embedImages(content, imageMap)
    content = embedded.content
    Object.assign(imageFiles, embedded.files)
    imageManifest = embedded.manifest
  }

  const { content: contentWithToc, entries: tocEntries } = buildToc(content)

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    ${creator ? `<dc:creator>${escapeXml(creator)}</dc:creator>` : ''}
    ${date ? `<dc:date>${date}</dc:date>` : ''}
    <dc:language>${lang}</dc:language>
    <dc:source>${escapeXml(sourceUrl)}</dc:source>
    <meta property="dcterms:modified">${now}T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${imageManifest}
  </manifest>
  <spine toc="ncx">
    <itemref idref="content"/>
  </spine>
</package>`

  const tocNavItems = tocEntries
    .map((e) => `    <li><a href="content.xhtml#${e.id}">${escapeXml(e.title)}</a></li>`)
    .join('\n')

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head><title>${escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc">
    <ol>
    <li><a href="content.xhtml">${escapeXml(title)}</a></li>
${tocNavItems}
    </ol>
  </nav>
</body>
</html>`

  const tocNcxPoints = tocEntries
    .map(
      (e, i) => `    <navPoint id="np${i + 2}" playOrder="${i + 2}">
      <navLabel><text>${escapeXml(e.title)}</text></navLabel>
      <content src="content.xhtml#${e.id}"/>
    </navPoint>`,
    )
    .join('\n')

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${id}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>${escapeXml(title)}</text></navLabel>
      <content src="content.xhtml"/>
    </navPoint>
${tocNcxPoints}
  </navMap>
</ncx>`

  const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${toXhtml(contentWithToc)}
  <footer>
    <p>
      <a href="${escapeXml(sourceUrl)}">${escapeXml(sourceUrl)}</a><br/>— via BookLike.app
    </p>
  </footer>
</body>
</html>`

  const css = `h1,h2,h3,figcaption{line-height:1.2}
img{max-width:100%;height:auto}
figure{margin:1.5em 0}
figcaption{font-size:.75em}
blockquote{border-left:3px solid #000;margin-left:0;padding-left:1em}
footer{margin-top:3em;padding-top:1em;border-top:1px solid #000;font-size:.75em}
footer p{hyphens:none}`

  return zipSync(
    {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/nav.xhtml': strToU8(nav),
      'OEBPS/toc.ncx': strToU8(ncx),
      'OEBPS/content.xhtml': strToU8(xhtml),
      'OEBPS/style.css': strToU8(css),
      ...imageFiles,
    },
    { mtime: new Date(), level: 1 },
  )
}
