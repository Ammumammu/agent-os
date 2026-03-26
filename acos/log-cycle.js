#!/usr/bin/env node
// acos/log-cycle.js — Manually log post performance into cycle tracker
// Usage: node acos/log-cycle.js
// Run AFTER every post you publish to track metrics

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CYCLE_LOG = join(__dirname, 'cycle-log.json');
const HOOK_LIBRARY = join(__dirname, 'hook-library.json');

function loadJSON(path, fallback = {}) {
    if (!existsSync(path)) return fallback;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function logCycle() {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('📊 ACOS CYCLE LOG — Post Performance Tracker');
    console.log('═══════════════════════════════════════════════════');
    console.log('Log this within 24 hours of posting.\n');

    const cycle = {};
    cycle.cycleId = `CYCLE-${Date.now()}`;
    cycle.loggedAt = new Date().toISOString();

    cycle.platform = await ask('Platform (TikTok/Reels/Shorts/LinkedIn/X): ');
    cycle.hookUsed = await ask('Hook text used (paste the opening line): ');
    cycle.hookType = await ask('Hook type (INCOME_REVEAL/BEFORE_AFTER/CONTRARIAN/COUNTDOWN/DEMO/PAIN/URGENCY): ');
    cycle.format = await ask('Format (screen_demo/talking_head/carousel/thread): ');

    console.log('\n📈 1-HOUR METRICS:');
    cycle.retention3sec_1hr = await ask('3-sec retention % at 1hr (e.g. 58): ');
    cycle.nonFollowerReach_1hr = await ask('Non-follower reach % at 1hr (e.g. 22): ');

    console.log('\n📈 24-HOUR METRICS:');
    cycle.watchTime_24hr = await ask('Average watch time % at 24hr (e.g. 47): ');
    cycle.saves_24hr = await ask('Saves at 24hr (absolute number): ');
    cycle.comments_24hr = await ask('Comments at 24hr: ');
    cycle.dmSends_24hr = await ask('DM sends at 24hr (if trackable): ');
    cycle.totalViews_24hr = await ask('Total views at 24hr: ');

    // Auto-calculate
    const views = parseInt(cycle.totalViews_24hr) || 1;
    const saves = parseInt(cycle.saves_24hr) || 0;
    const comments = parseInt(cycle.comments_24hr) || 0;
    cycle.saveRate = ((saves / views) * 100).toFixed(2) + '%';
    cycle.commentRate = ((comments / views) * 100).toFixed(2) + '%';

    // Algorithm response
    const retention = parseFloat(cycle.retention3sec_1hr);
    const nonFollower = parseFloat(cycle.nonFollowerReach_1hr);
    const watchTime = parseFloat(cycle.watchTime_24hr);

    if (nonFollower >= 30) cycle.algorithmResponse = 'NON_FOLLOWER_BOOSTED';
    else if (nonFollower >= 15) cycle.algorithmResponse = 'MODERATE';
    else cycle.algorithmResponse = 'FOLLOWER_CAPPED';

    // Gate checks
    cycle.gateChecks = {
        retention3sec: retention >= 60 ? 'PASS' : 'FAIL',
        watchTime: watchTime >= 50 ? 'PASS' : 'FAIL',
        nonFollowerReach: nonFollower >= 30 ? 'PASS' : 'FAIL',
    };

    const allPass = Object.values(cycle.gateChecks).every(v => v === 'PASS');
    cycle.overallGate = allPass ? 'PASS' : 'FAIL';

    cycle.valuePassed = await ask('Value type hit (insight/emotional/utility/identity): ');
    cycle.hookPayoffAligned = await ask('Did content fully deliver what hook promised? (yes/no): ');
    cycle.outlierGap = await ask('What would a top 1% creator have done differently?: ');
    cycle.nextAdjustment = await ask('What exactly changes for next post?: ');

    rl.close();

    // Check for 3x viral trigger
    const previous = loadJSON(CYCLE_LOG, { cycles: [] });
    const avgViews = previous.cycles?.filter(c => c.totalViews_24hr)
        .reduce((sum, c, _, arr) => sum + (parseInt(c.totalViews_24hr) || 0) / arr.length, 0) || 0;

    if (avgViews > 0 && views >= avgViews * 3) {
        cycle.viralTrigger = true;
        cycle.viralAction = '🔥 3× VIRAL TRIGGER — PRODUCE 3 VARIATIONS WITHIN 72 HOURS';
        console.log('\n🔥 VIRAL REPLICATION PROTOCOL TRIGGERED!');
        console.log('   This post hit 3× your average. IMMEDIATELY create 3 variations:');
        console.log('   1. Same hook + different example/story');
        console.log('   2. Part 2 — deeper expansion of the winning concept');
        console.log('   3. Format switch (video → carousel, or repurpose to different platform)');
        console.log('   Do this within 72 hours. Do NOT wait for next cycle.');
    }

    // Save cycle
    previous.cycles = [cycle, ...(previous.cycles || [])].slice(0, 100);
    previous.lastUpdated = new Date().toISOString();
    saveJSON(CYCLE_LOG, previous);

    // Update hook library with real performance
    const hookLib = loadJSON(HOOK_LIBRARY, { hooks: [] });
    const hookEntry = hookLib.hooks?.find(h => h.hookText === cycle.hookUsed);
    if (hookEntry) {
        hookEntry.actual3secRetention = cycle.retention3sec_1hr;
        hookEntry.actualWatchTime = cycle.watchTime_24hr;
        hookEntry.actualNonFollowerReach = cycle.nonFollowerReach_1hr;
        hookEntry.gateResult = cycle.overallGate;
        hookEntry.status = 'tested';
        if (retention >= 60) hookEntry.reusableTemplate = true;
        saveJSON(HOOK_LIBRARY, hookLib);
    }

    // Summary
    console.log('\n' + '═'.repeat(55));
    console.log('📊 CYCLE SUMMARY');
    console.log('═'.repeat(55));
    console.log(`3-sec Retention: ${cycle.retention3sec_1hr}% → Gate: ${cycle.gateChecks.retention3sec}`);
    console.log(`Watch Time:      ${cycle.watchTime_24hr}% → Gate: ${cycle.gateChecks.watchTime}`);
    console.log(`Non-Follower:    ${cycle.nonFollowerReach_1hr}% → Gate: ${cycle.gateChecks.nonFollowerReach}`);
    console.log(`Save Rate:       ${cycle.saveRate}`);
    console.log(`Algorithm:       ${cycle.algorithmResponse}`);
    console.log(`Overall Gate:    ${cycle.overallGate}`);
    console.log('');

    const passCount = Object.values(cycle.gateChecks).filter(v => v === 'PASS').length;
    const totalCycles = previous.cycles?.length || 1;
    const passingCycles = previous.cycles?.filter(c => c.overallGate === 'PASS').length || 0;

    console.log(`Mastery Progress: ${passingCycles}/10 consecutive posts needed`);
    console.log(`Total cycles logged: ${totalCycles}`);

    if (allPass) {
        console.log('\n🟢 ALL GATES PASSED — keep this momentum going!');
    } else {
        console.log('\n🔴 FIX BEFORE NEXT POST:');
        if (cycle.gateChecks.retention3sec === 'FAIL') {
            console.log('   → Hook fix: Start mid-action. Add text overlay in first 2 seconds.');
        }
        if (cycle.gateChecks.watchTime === 'FAIL') {
            console.log('   → Retention fix: Add curiosity injector at 20s and 40s mark.');
        }
        if (cycle.gateChecks.nonFollowerReach === 'FAIL') {
            console.log('   → Distribution fix: Hook likely reached only followers. Kill this hook type.');
        }
    }

    console.log(`\n✅ Cycle logged to ${CYCLE_LOG}`);
    console.log('═'.repeat(55));
}

logCycle().catch(console.error);
