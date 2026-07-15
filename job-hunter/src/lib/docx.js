// docx.js — render a tailored resume / cover letter (Markdown) to a .docx file.
//
// The tailor produces Markdown; Dave gets both the .md source (easy to edit)
// and a .docx (ready to attach). This is a deliberately small Markdown subset —
// headings (#, ##, ###), bullet lists (-, *), bold (**text**), and paragraphs —
// which is all a standard US resume + cover letter needs. No external template.

import fs from 'node:fs';
import path from 'node:path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';

// Split a line into runs, honouring **bold** spans only.
function inlineRuns(text) {
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    runs.push(new TextRun({ text: m[1], bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

function markdownToParagraphs(md) {
  const out = [];
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      out.push(new Paragraph({ children: [new TextRun('')] }));
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(line.slice(4)) }));
    } else if (line.startsWith('## ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(line.slice(3)) }));
    } else if (line.startsWith('# ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(line.slice(2)) }));
    } else if (/^\s*[-*]\s+/.test(line)) {
      out.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(line.replace(/^\s*[-*]\s+/, '')) }));
    } else {
      out.push(new Paragraph({ children: inlineRuns(line) }));
    }
  }
  return out;
}

// Write a .docx from Markdown. Returns the absolute path written.
export async function writeDocx(markdown, filePath) {
  const doc = new Document({
    sections: [{ properties: {}, children: markdownToParagraphs(markdown) }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Convenience: also drop the raw Markdown next to the .docx so Dave can edit.
export function writeMarkdown(markdown, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(markdown || ''));
  return filePath;
}
