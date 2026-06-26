#!/usr/bin/env node
/**
 * Aggregator PDF Generator — 2 content templates, 4 print-friendly outputs.
 * Single page, sentence case, no emojis. QR code points to the org's
 * track_link when provided, else falls back to the default booking link.
 *
 * Usage:
 *   node aggregator/scripts/pdf-generator.js --all
 *       (regenerates the 4 default lane PDFs with the fallback booking link)
 *   node aggregator/scripts/pdf-generator.js --type license_prep --track-link <url> --out custom.pdf
 *       (one-off personalized PDF for a specific org's track_link)
 *
 * Writes: aggregator/pdfs/pdf_license_prep.pdf
 *         aggregator/pdfs/pdf_sbdc_handout.pdf
 *         aggregator/pdfs/pdf_trade_school.pdf
 *         aggregator/pdfs/pdf_bonding_partner.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const { baseBookingUrl } = require('../lib/track-link');
const handout = require('../templates/student-handout-content');
const partner = require('../templates/bonding-partner-content');

const PDFS_DIR = path.join(__dirname, '..', 'pdfs');

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);

const HANDOUT_VARIANTS = {
  license_prep: {
    file: 'pdf_license_prep.pdf',
    intro: 'Built for students finishing license prep — work through these five steps after you pass the exam.',
    footer: 'Step 4 is the one most new contractors put off the longest. Trevo Advisors builds simple contractor websites for the trades — $100 flat, no monthly fee.'
  },
  sbdc_score: {
    file: 'pdf_sbdc_handout.pdf',
    intro: 'A free resource for new contractors — share, print or link however is useful.',
    footer: 'This handout is free to use however is useful. Trevo Advisors builds simple contractor websites for the trades, if step 4 ever comes up.'
  },
  trade_school: {
    file: 'pdf_trade_school.pdf',
    intro: 'Built for graduates about to go out on their own.',
    footer: 'If step 4 feels like a lot on top of everything else, Trevo Advisors builds simple contractor websites for new graduates — $100 flat, no monthly fee.'
  }
};

async function qrBuffer(url) {
  return QRCode.toBuffer(url, { margin: 1, width: 200 });
}

async function renderHandoutPdf(outPath, variant, trackLink) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  doc.pipe(fs.createWriteStream(outPath));

  doc.font('Helvetica-Bold').fontSize(20).text(handout.TITLE, { align: 'left' });
  doc.moveDown(0.4);
  doc.font('Helvetica-Oblique').fontSize(11).fillColor('#444444').text(variant.intro);
  doc.moveDown(0.8);
  doc.fillColor('#000000');

  for (const step of handout.STEPS) {
    doc.font('Helvetica-Bold').fontSize(13).text(step.title);
    doc.font('Helvetica').fontSize(11).text(step.body, { paragraphGap: 4 });
    doc.moveDown(0.5);
  }

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).fillColor('#444444').text(variant.footer);

  const qr = await qrBuffer(trackLink);
  doc.moveDown(0.6);
  const qrSize = 80;
  doc.image(qr, doc.page.margins.left, doc.y, { width: qrSize, height: qrSize });
  doc.font('Helvetica').fontSize(9).fillColor('#666666')
    .text('Scan to book a time, or visit:', doc.page.margins.left + qrSize + 10, doc.y - qrSize + 8, { width: 300 })
    .text(trackLink, doc.page.margins.left + qrSize + 10, doc.y, { width: 300, link: trackLink, underline: true });

  doc.end();
}

async function renderPartnerPdf(outPath, trackLink) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  doc.pipe(fs.createWriteStream(outPath));

  doc.font('Helvetica-Bold').fontSize(20).text(partner.TITLE);
  doc.moveDown(0.8);

  for (const section of partner.SECTIONS) {
    doc.font('Helvetica-Bold').fontSize(13).text(section.heading);
    doc.font('Helvetica').fontSize(11).text(section.body, { paragraphGap: 4 });
    doc.moveDown(0.5);
  }

  const qr = await qrBuffer(trackLink);
  doc.moveDown(0.6);
  const qrSize = 80;
  doc.image(qr, doc.page.margins.left, doc.y, { width: qrSize, height: qrSize });
  doc.font('Helvetica').fontSize(9).fillColor('#666666')
    .text('Scan to set up the referral, or visit:', doc.page.margins.left + qrSize + 10, doc.y - qrSize + 8, { width: 300 })
    .text(trackLink, doc.page.margins.left + qrSize + 10, doc.y, { width: 300, link: trackLink, underline: true });

  doc.end();
}

async function main() {
  fs.mkdirSync(PDFS_DIR, { recursive: true });
  const fallbackLink = baseBookingUrl();

  if (hasFlag('--all') || args.length === 0) {
    for (const [type, variant] of Object.entries(HANDOUT_VARIANTS)) {
      await renderHandoutPdf(path.join(PDFS_DIR, variant.file), variant, fallbackLink);
      console.log(`  Wrote aggregator/pdfs/${variant.file}`);
    }
    await renderPartnerPdf(path.join(PDFS_DIR, 'pdf_bonding_partner.pdf'), fallbackLink);
    console.log('  Wrote aggregator/pdfs/pdf_bonding_partner.pdf');
    return;
  }

  const type = get('--type');
  const trackLink = get('--track-link') || fallbackLink;
  const out = get('--out');

  if (type === 'bonding_insurance') {
    const outPath = path.join(PDFS_DIR, out || 'pdf_bonding_partner.pdf');
    await renderPartnerPdf(outPath, trackLink);
    console.log(`  Wrote ${outPath}`);
    return;
  }

  const variant = HANDOUT_VARIANTS[type];
  if (!variant) {
    console.error(`--type must be one of: ${[...Object.keys(HANDOUT_VARIANTS), 'bonding_insurance'].join(', ')}`);
    process.exit(1);
  }
  const outPath = path.join(PDFS_DIR, out || variant.file);
  await renderHandoutPdf(outPath, variant, trackLink);
  console.log(`  Wrote ${outPath}`);
}

main().catch((e) => {
  console.error('PDF generation failed:', e.message);
  process.exit(1);
});
