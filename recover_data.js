#!/usr/bin/env node
// Data Recovery Script for Champion Course Lead Center
// Merges all CSV files from Downloads into a recoverable JSON file

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DOWNLOADS = '/Users/solveracademy/Downloads';
const OUTPUT = '/Users/solveracademy/Documents/Champion Course/recovered-leads.json';

// List of all CSV files to process
const CSV_FILES = [
  { path: join(DOWNLOADS, 'lead-center-export-2026-06-14.csv'), course: null },
  { path: join(DOWNLOADS, 'IP + 无限 1_2026-06-21.csv'), course: 'IP + 无限引流' },
  { path: join(DOWNLOADS, '企业孙子兵法-copy_Leads_2026-05-16_2026-06-21.csv'), course: '企业孙子兵法' },
  { path: join(DOWNLOADS, 'IP + 无限 流量2026_Leads_2026-06-18_2026-06-21.csv'), course: 'IP + 无限引流+收网系统' },
  { path: join(DOWNLOADS, '-IP + 无限 流量2026_Leads_2026-06-18_2026-06-21.csv'), course: 'IP + 无限引流+收网系统' },
  { path: join(DOWNLOADS, '营销红利.csv'), course: '营销红利' },
  { path: join(DOWNLOADS, '流量密码 May_Leads_2026-05-03_2026-06-21.csv'), course: '流量密码2026' },
  { path: join(DOWNLOADS, '孙子兵法 June_Leads_2026-05-16_2026-06-21 (1).csv'), course: '企业孙子兵法' },
  { path: join(DOWNLOADS, '流量密码 2.0.csv'), course: '流量密码2.0' },
  { path: join(DOWNLOADS, '孙子兵法 June_Leads_2026-05-16_2026-06-21.csv'), course: '企业孙子兵法' },
  { path: join(DOWNLOADS, 'IP重播课-copy_Leads_2026-06-10_2026-06-21.csv'), course: 'IP重播课' },
];

function normalize(v) {
  return String(v || '').trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/gi, '');
}

function cleanPhone(v) {
  return String(v || '').trim().replace(/^p:/i, '').trim();
}

function decodeBuffer(buf) {
  // Detect UTF-16 BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    // Swap bytes for big-endian
    const swapped = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length - 1; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  // Check for lots of null bytes = UTF-16 without BOM
  const nullCount = [...buf.slice(0, 200)].filter(b => b === 0).length;
  if (nullCount > 25) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const clean = text.replace(/^\uFEFF/, '').replace(/^\uFFFE/, '');

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i], n = clean[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; }
    else if (c === '"') { quoted = !quoted; }
    else if (c === '\t' && !quoted) { row.push(cell); cell = ''; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else { cell += c; }
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

function findHeader(headers, ...names) {
  for (const name of names) {
    const found = headers.find(h => normalize(h) === normalize(name));
    if (found) return found;
  }
  return null;
}

const allLeads = new Map(); // dedup by phone or name
let totalProcessed = 0;

for (const { path, course: overrideCourse } of CSV_FILES) {
  let buf;
  try { buf = readFileSync(path); } catch (e) { console.warn(`Skipping ${path}: ${e.message}`); continue; }

  const text = decodeBuffer(buf);
  const rows = parseCSV(text);
  if (rows.length < 2) continue;

  const headers = rows[0].map(h => h.trim());
  const nameCol = findHeader(headers, 'full_name', 'name', 'Full Name', 'full name');
  const phoneCol = findHeader(headers, 'phone_number', 'phone', 'Phone', 'Phone Number');
  const emailCol = findHeader(headers, 'email', 'Email');
  const jobCol = findHeader(headers, 'job_title', 'job', 'Job', 'Job Title');
  const courseCol = findHeader(headers, 'course', 'form_name', 'Course');
  const createdCol = findHeader(headers, 'created_time', 'Created Time');

  console.log(`\n📄 ${path.split('/').pop()}`);
  console.log(`   Headers: ${headers.slice(0, 8).join(', ')}...`);
  console.log(`   Rows: ${rows.length - 1}`);

  let fileAdded = 0;
  for (const row of rows.slice(1)) {
    const record = Object.fromEntries(headers.map((h, i) => [h, row[i] || '']));
    const rawName = record[nameCol] || '';
    const rawPhone = record[phoneCol] || '';
    const rawEmail = record[emailCol] || '';
    const rawJob = record[jobCol] || '';
    const rawCourse = overrideCourse || record[courseCol] || '';
    const rawCreated = record[createdCol] || '';

    const name = rawName.trim().replace(/^"(.*)"$/, '$1').trim();
    const phone = cleanPhone(rawPhone);
    const email = rawEmail.trim().replace(/^"(.*)"$/, '$1').trim();
    const job = rawJob.trim().replace(/^"(.*)"$/, '$1').trim();
    const course = rawCourse.trim().replace(/^"(.*)"$/, '$1').trim();

    if (!name && !phone && !email) continue;

    // Dedup key: normalize(phone) or normalize(name)
    const phoneDigits = phone.replace(/[^\d]/g, '');
    const key = phoneDigits.length >= 8 ? `phone:${phoneDigits}` : `name:${normalize(name)}`;

    if (allLeads.has(key)) {
      // Merge: keep existing, supplement missing fields
      const existing = allLeads.get(key);
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.email && email) existing.email = email;
      if (!existing.job && job) existing.job = job;
      if (!existing.course && course) existing.course = course;
      continue;
    }

    const lead = {
      id: randomUUID(),
      identity: key,
      name: name || 'Unknown Lead',
      phone,
      email,
      job,
      createdAt: rawCreated ? new Date(rawCreated).toISOString() : new Date().toISOString(),
      status: 'new',
      completedSteps: [],
      lastContactedAt: '',
      notes: '',
      history: [],
      course,
      amountPaid: '',
      profit: '',
      paymentMethod: '',
      enrollmentDate: '',
      followupStage: '',
      followupAction: '',
      memberLevel: '',
      manual: false,
      nextFollowUpDate: '',
    };

    allLeads.set(key, lead);
    fileAdded++;
    totalProcessed++;
  }
  console.log(`   ✅ Added ${fileAdded} new leads`);
}

const leads = Array.from(allLeads.values());

console.log(`\n🎯 Total unique leads recovered: ${leads.length}`);
console.log(`   (from ${totalProcessed} total records across all files)`);

// Build the recovery JSON in the same format as a backup
const output = {
  version: 2,
  savedAt: new Date().toISOString(),
  recoveredFrom: 'CSV files in Downloads',
  leads,
  templates: {},
  previews: [],
  videos: [],
  customGroups: [],
  courseOrder: [],
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
console.log(`\n✅ Recovery file saved to:`);
console.log(`   ${OUTPUT}`);
console.log(`\nNext steps:`);
console.log(`   1. Open index.html in Chrome`);
console.log(`   2. Click "☁ Backup" → "Restore from JSON File"`);
console.log(`   3. Select: recovered-leads.json`);
console.log(`   4. All ${leads.length} leads will be restored!`);
console.log(`\n⚠️  Note: The 5 closed deals with 20k revenue will need to be manually re-entered`);
console.log(`   because enrollment/payment data was not in the original CSV exports.`);
