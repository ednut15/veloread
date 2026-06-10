import JSZip from 'jszip';
import {
  EPUB_LIMITS,
  decodeHtmlEntities,
  extractEpubSections,
  extractMarkupTitle,
  fallbackChapterTitle,
  htmlToText,
  resolvePath,
} from '@/src/utils/epub';
import { ImportError } from '@/src/utils/errors';

async function buildEpubBase64(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'base64', compression: 'STORE' });
}

function containerXml(opfPath = 'OEBPS/content.opf'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function opfXml({
  title = 'Test Book',
  manifest,
  spine,
}: {
  title?: string;
  manifest: string;
  spine: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`;
}

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body><h1>${title}</h1><p>${body}</p></body>
</html>`;
}

function simpleEpubFiles(): Record<string, string> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': containerXml(),
    'OEBPS/content.opf': opfXml({
      manifest: `
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="style.css" media-type="text/css"/>`,
      spine: `
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
        <itemref idref="nav"/>`,
    }),
    'OEBPS/nav.xhtml': chapterXhtml('Table of Contents', 'Navigation links live here.'),
    'OEBPS/chapter1.xhtml': chapterXhtml('Chapter One', 'The first chapter text.'),
    'OEBPS/chapter2.xhtml': chapterXhtml('Chapter Two', 'The second chapter text.'),
    'OEBPS/style.css': 'body { color: black; }',
  };
}

describe('extractEpubSections', () => {
  it('extracts the book title and chapters in spine order, skipping nav documents', async () => {
    const base64 = await buildEpubBase64(simpleEpubFiles());
    const { title, sections } = await extractEpubSections(base64);

    expect(title).toBe('Test Book');
    expect(sections.map((s) => s.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(sections[0].text).toContain('The first chapter text.');
    expect(sections[1].text).toContain('The second chapter text.');
    expect(sections.some((s) => s.text.includes('Navigation links'))).toBe(false);
  });

  it('decodes HTML entities in extracted text', async () => {
    const files = simpleEpubFiles();
    files['OEBPS/chapter1.xhtml'] = chapterXhtml(
      'Chapter One',
      'Fish &amp; chips cost &#163;5 &mdash; that&rsquo;s cheap.'
    );
    const base64 = await buildEpubBase64(files);
    const { sections } = await extractEpubSections(base64);

    expect(sections[0].text).toContain("Fish & chips cost £5 -- that's cheap.");
  });

  it('resolves relative, parent-traversing, and URL-encoded hrefs against the OPF directory', async () => {
    const base64 = await buildEpubBase64({
      'META-INF/container.xml': containerXml('content/book.opf'),
      'content/book.opf': opfXml({
        manifest: `
          <item id="ch1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
          <item id="ch2" href="../shared/chapter2.xhtml" media-type="application/xhtml+xml"/>`,
        spine: `
          <itemref idref="ch1"/>
          <itemref idref="ch2"/>`,
      }),
      'content/text/chapter 1.xhtml': chapterXhtml('First', 'Alpha text.'),
      'shared/chapter2.xhtml': chapterXhtml('Second', 'Beta text.'),
    });

    const { sections } = await extractEpubSections(base64);
    expect(sections.map((s) => s.title)).toEqual(['First', 'Second']);
  });

  it('matches chapter paths case-insensitively', async () => {
    const files = simpleEpubFiles();
    const chapter1 = files['OEBPS/chapter1.xhtml'];
    delete files['OEBPS/chapter1.xhtml'];
    files['OEBPS/Chapter1.XHTML'] = chapter1;

    const base64 = await buildEpubBase64(files);
    const { sections } = await extractEpubSections(base64);
    expect(sections.map((s) => s.title)).toEqual(['Chapter One', 'Chapter Two']);
  });

  it('falls back to manifest order when the spine is empty', async () => {
    const files = simpleEpubFiles();
    files['OEBPS/content.opf'] = opfXml({
      manifest: `
        <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>`,
      spine: '',
    });

    const base64 = await buildEpubBase64(files);
    const { sections } = await extractEpubSections(base64);
    expect(sections).toHaveLength(2);
  });

  it('rejects an EPUB without META-INF/container.xml', async () => {
    const base64 = await buildEpubBase64({ mimetype: 'application/epub+zip' });
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'Invalid EPUB: META-INF/container.xml is missing.'
    );
  });

  it('rejects a container without a package document path', async () => {
    const base64 = await buildEpubBase64({
      'META-INF/container.xml': '<container><rootfiles></rootfiles></container>',
    });
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'Invalid EPUB: package document path not found.'
    );
  });

  it('rejects a container pointing at a missing package document', async () => {
    const base64 = await buildEpubBase64({
      'META-INF/container.xml': containerXml('missing.opf'),
    });
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'Invalid EPUB: package document could not be read.'
    );
  });

  it('rejects an EPUB without readable chapter documents', async () => {
    const base64 = await buildEpubBase64({
      'META-INF/container.xml': containerXml(),
      'OEBPS/content.opf': opfXml({
        manifest: '<item id="img" href="cover.png" media-type="image/png"/>',
        spine: '<itemref idref="img"/>',
      }),
      'OEBPS/cover.png': 'not-really-a-png',
    });
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'This EPUB does not contain readable chapter documents.'
    );
  });

  it('rejects an EPUB with too many spine sections', async () => {
    const count = EPUB_LIMITS.maxSpineSections + 1;
    const manifest = Array.from(
      { length: count },
      (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`
    ).join('');
    const spine = Array.from({ length: count }, (_, i) => `<itemref idref="c${i}"/>`).join('');

    const base64 = await buildEpubBase64({
      'META-INF/container.xml': containerXml(),
      'OEBPS/content.opf': opfXml({ manifest, spine }),
    });
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'This EPUB contains too many chapters/sections to import safely.'
    );
  });

  it('rejects an EPUB with too many zip entries', async () => {
    const files: Record<string, string> = {
      'META-INF/container.xml': containerXml(),
    };
    for (let i = 0; i <= EPUB_LIMITS.maxZipEntries; i += 1) {
      files[`junk/file-${i}.txt`] = 'x';
    }
    const base64 = await buildEpubBase64(files);
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'This EPUB contains too many files to import safely.'
    );
  });

  it('rejects a single chapter that exceeds the section size cap', async () => {
    const files = simpleEpubFiles();
    files['OEBPS/chapter1.xhtml'] = chapterXhtml(
      'Huge',
      'a'.repeat(EPUB_LIMITS.maxSectionTextChars + 10)
    );
    const base64 = await buildEpubBase64(files);
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'A chapter in this EPUB is too large to import safely.'
    );
  });

  it('rejects an EPUB whose total extracted text exceeds the cap', async () => {
    const sectionChars = EPUB_LIMITS.maxSectionTextChars - 1000;
    const count = Math.ceil(EPUB_LIMITS.maxTotalTextChars / sectionChars) + 1;
    const files: Record<string, string> = {
      'META-INF/container.xml': containerXml(),
    };
    const manifestItems: string[] = [];
    const spineItems: string[] = [];
    const body = 'a'.repeat(sectionChars);
    for (let i = 0; i < count; i += 1) {
      manifestItems.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`);
      spineItems.push(`<itemref idref="c${i}"/>`);
      files[`OEBPS/c${i}.xhtml`] = `<html><body>${body}</body></html>`;
    }
    files['OEBPS/content.opf'] = opfXml({
      manifest: manifestItems.join(''),
      spine: spineItems.join(''),
    });

    const base64 = await buildEpubBase64(files);
    await expect(extractEpubSections(base64)).rejects.toThrow(
      'This EPUB is too large to import on this device.'
    );
  });

  it('throws ImportError instances for known failures', async () => {
    const base64 = await buildEpubBase64({ mimetype: 'application/epub+zip' });
    await expect(extractEpubSections(base64)).rejects.toBeInstanceOf(ImportError);
  });

  it('reports monotonically increasing progress', async () => {
    const base64 = await buildEpubBase64(simpleEpubFiles());
    const seen: number[] = [];
    await extractEpubSections(base64, (progress) => seen.push(progress));

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles, and tags while keeping block breaks', () => {
    const markup = `<html><head><style>p { color: red; }</style>
      <script>alert('hi');</script></head>
      <body><p>First paragraph.</p><p>Second<br/>line.</p></body></html>`;
    const text = htmlToText(markup);

    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second\nline.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color: red');
  });
});

describe('extractMarkupTitle', () => {
  it('prefers h1 over the document title', () => {
    const markup = '<html><head><title>Doc Title</title></head><body><h1>Heading</h1></body></html>';
    expect(extractMarkupTitle(markup)).toBe('Heading');
  });

  it('falls back to the document title, then h2', () => {
    expect(extractMarkupTitle('<title>Doc Title</title>')).toBe('Doc Title');
    expect(extractMarkupTitle('<h2>Section</h2>')).toBe('Section');
    expect(extractMarkupTitle('<p>No headings</p>')).toBeNull();
  });

  it('truncates very long titles', () => {
    const markup = `<h1>${'T'.repeat(200)}</h1>`;
    const title = extractMarkupTitle(markup);
    expect(title).toHaveLength(120);
    expect(title?.endsWith('...')).toBe(true);
  });
});

describe('fallbackChapterTitle', () => {
  it('builds a readable title from the file name', () => {
    expect(fallbackChapterTitle('OEBPS/the_first_chapter.xhtml', 0)).toBe('the first chapter');
    expect(fallbackChapterTitle('OEBPS/chapter%201.xhtml', 0)).toBe('chapter 1');
  });

  it('falls back to a numbered chapter for unreadable names', () => {
    expect(fallbackChapterTitle('OEBPS/___.xhtml', 4)).toBe('Chapter 5');
  });
});

describe('resolvePath', () => {
  it('joins relative paths against the base directory', () => {
    expect(resolvePath('OEBPS', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('collapses parent and current directory segments', () => {
    expect(resolvePath('OEBPS/text', '../images/pic.png')).toBe('OEBPS/images/pic.png');
    expect(resolvePath('OEBPS', './ch1.xhtml')).toBe('OEBPS/ch1.xhtml');
  });

  it('strips fragments, query strings, and decodes URL encoding', () => {
    expect(resolvePath('OEBPS', 'ch1.xhtml#section-2')).toBe('OEBPS/ch1.xhtml');
    expect(resolvePath('OEBPS', 'ch1.xhtml?x=1')).toBe('OEBPS/ch1.xhtml');
    expect(resolvePath('OEBPS', 'my%20chapter.xhtml')).toBe('OEBPS/my chapter.xhtml');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal, and hex entities', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
    expect(decodeHtmlEntities('&#65;&#x42;')).toBe('AB');
    expect(decodeHtmlEntities('caf&eacute;')).toBe('caf&eacute;');
  });

  it('drops invalid code points', () => {
    expect(decodeHtmlEntities('&#0;')).toBe('');
    expect(decodeHtmlEntities('&#x110000;')).toBe('');
  });
});
